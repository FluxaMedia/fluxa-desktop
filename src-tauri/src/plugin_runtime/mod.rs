mod dom_bridge;

use crate::net_guard;
use dom_bridge::DomBridge;
use rquickjs::{AsyncContext, AsyncRuntime, CatchResultExt, Ctx, Function};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const PLUGIN_TIMEOUT_SECS: u64 = 60;
const FETCH_TIMEOUT_SECS: u64 = 15;

/// Runs a Nuvio-compatible scraper plugin's `getStreams()` inside a
/// sandboxed QuickJS VM and returns its raw (unvalidated) JSON output.
/// Must be called from a blocking context (e.g. `spawn_blocking`) — it
/// builds its own single-threaded tokio runtime because the JS engine's
/// internal state (via `scraper`/`tendril`) isn't `Send`.
pub fn execute_scraper(
    code: String,
    tmdb_id: String,
    media_type: String,
    season: Option<i32>,
    episode: Option<i32>,
) -> Result<String, String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let local = tokio::task::LocalSet::new();
    local.block_on(&rt, async move {
        tokio::time::timeout(
            Duration::from_secs(PLUGIN_TIMEOUT_SECS),
            run(code, tmdb_id, media_type, season, episode),
        )
        .await
        .unwrap_or_else(|_| Err("plugin timed out".to_string()))
    })
}

async fn run(
    code: String,
    tmdb_id: String,
    media_type: String,
    season: Option<i32>,
    episode: Option<i32>,
) -> Result<String, String> {
    let qjs_rt = AsyncRuntime::new().map_err(|e| e.to_string())?;
    tokio::task::spawn_local(qjs_rt.drive());
    let ctx = AsyncContext::full(&qjs_rt).await.map_err(|e| e.to_string())?;

    let captured: Arc<Mutex<Option<String>>> = Default::default();
    let captured_clone = captured.clone();
    let dom = DomBridge::new();

    let eval_result: rquickjs::Result<()> = ctx
        .async_with(async |ctx| {
            register_host_functions(&ctx, &dom)?;

            let tmdb_id_arg = serde_json::to_string(&tmdb_id).unwrap_or_else(|_| "\"\"".into());
            let media_type_arg =
                serde_json::to_string(&media_type).unwrap_or_else(|_| "\"movie\"".into());
            let season_arg = season.map(|s| s.to_string()).unwrap_or_else(|| "undefined".into());
            let episode_arg = episode.map(|e| e.to_string()).unwrap_or_else(|| "undefined".into());

            let script = format!(
                r#"
                globalThis.global = globalThis;
                globalThis.window = globalThis;

                function fetch(url, options) {{
                    options = options || {{}};
                    return __native_fetch(url).then(function(raw) {{
                        var parsed = JSON.parse(raw);
                        return {{
                            ok: parsed.ok,
                            status: parsed.status,
                            text: function() {{ return Promise.resolve(parsed.body); }},
                            json: function() {{
                                try {{ return Promise.resolve(JSON.parse(parsed.body)); }}
                                catch (e) {{ return Promise.resolve(null); }}
                            }}
                        }};
                    }});
                }}

                {cheerio_polyfill}

                var require = function(name) {{
                    if (name.indexOf('cheerio') !== -1) return cheerio;
                    throw new Error('module not available: ' + name);
                }};

                var module = {{ exports: {{}} }};
                var exports = module.exports;
                (function() {{
                    {code}
                }})();

                (async function() {{
                    try {{
                        var getStreams = module.exports.getStreams || globalThis.getStreams;
                        if (!getStreams) {{
                            __capture_result(JSON.stringify([]));
                            return;
                        }}
                        var streams = await getStreams({tmdb_id_arg}, {media_type_arg}, {season_arg}, {episode_arg});
                        __capture_result(JSON.stringify(streams || []));
                    }} catch (e) {{
                        __capture_result(JSON.stringify([]));
                    }}
                }})();
                "#,
                cheerio_polyfill = CHEERIO_POLYFILL,
                code = code,
            );

            ctx.globals().set(
                "__capture_result",
                Function::new(ctx.clone(), move |s: String| {
                    *captured_clone.lock().expect("capture lock poisoned") = Some(s);
                })?,
            )?;

            ctx.eval::<(), _>(script).catch(&ctx).map_err(|e| {
                rquickjs::Error::new_from_js_message("plugin", "js", e.to_string())
            })?;

            Ok(())
        })
        .await;

    eval_result.map_err(|e| e.to_string())?;
    qjs_rt.idle().await;

    let result = captured
        .lock()
        .expect("capture lock poisoned")
        .take()
        .unwrap_or_else(|| "[]".to_string());
    Ok(result)
}

async fn native_fetch(url: String) -> rquickjs::Result<String> {
    if let Err(message) = net_guard::ensure_public_host(&url).await {
        return Ok(fetch_error_json(&url, &message));
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
    {
        Ok(client) => client,
        Err(e) => return Ok(fetch_error_json(&url, &e.to_string())),
    };

    match client
        .get(&url)
        .header("User-Agent", "Fluxa/1.0")
        .send()
        .await
    {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            Ok(format!(
                "{{\"ok\":{},\"status\":{},\"body\":{}}}",
                (200..300).contains(&status),
                status,
                serde_json::to_string(&body).unwrap_or_else(|_| "\"\"".into())
            ))
        }
        Err(e) => Ok(fetch_error_json(&url, &e.to_string())),
    }
}

fn fetch_error_json(url: &str, message: &str) -> String {
    format!(
        "{{\"ok\":false,\"status\":0,\"body\":\"\",\"url\":{},\"error\":{}}}",
        serde_json::to_string(url).unwrap_or_else(|_| "\"\"".into()),
        serde_json::to_string(message).unwrap_or_else(|_| "\"\"".into())
    )
}

fn register_host_functions(ctx: &Ctx<'_>, dom: &Rc<DomBridge>) -> rquickjs::Result<()> {
    ctx.globals().set(
        "console",
        rquickjs::Object::new(ctx.clone()).and_then(|obj| {
            obj.set(
                "log",
                Function::new(ctx.clone(), |msg: String| log::debug!("[plugin] {msg}"))?,
            )?;
            obj.set(
                "warn",
                Function::new(ctx.clone(), |msg: String| log::warn!("[plugin] {msg}"))?,
            )?;
            obj.set(
                "error",
                Function::new(ctx.clone(), |msg: String| log::warn!("[plugin] {msg}"))?,
            )?;
            obj.set(
                "info",
                Function::new(ctx.clone(), |msg: String| log::debug!("[plugin] {msg}"))?,
            )?;
            obj.set(
                "debug",
                Function::new(ctx.clone(), |msg: String| log::debug!("[plugin] {msg}"))?,
            )?;
            Ok(obj)
        })?,
    )?;

    ctx.globals().set(
        "__native_fetch",
        Function::new(ctx.clone(), rquickjs::function::Async(native_fetch))?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_load",
        Function::new(ctx.clone(), move |html: String| d.load(html))?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_select",
        Function::new(ctx.clone(), move |doc_id: String, selector: String| {
            d.select(doc_id, selector)
        })?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_find",
        Function::new(
            ctx.clone(),
            move |doc_id: String, element_id: String, selector: String| d.find(doc_id, element_id, selector),
        )?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_text",
        Function::new(ctx.clone(), move |_doc_id: String, element_ids: String| {
            d.text(element_ids)
        })?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_html",
        Function::new(ctx.clone(), move |doc_id: String, element_id: String| {
            d.html(doc_id, element_id)
        })?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_inner_html",
        Function::new(ctx.clone(), move |_doc_id: String, element_id: String| {
            d.inner_html(element_id)
        })?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_attr",
        Function::new(ctx.clone(), move |_doc_id: String, element_id: String, attr_name: String| {
            d.attr(element_id, attr_name)
        })?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_next",
        Function::new(ctx.clone(), move |doc_id: String, element_id: String| {
            d.next(doc_id, element_id)
        })?,
    )?;

    let d = dom.clone();
    ctx.globals().set(
        "__cheerio_prev",
        Function::new(ctx.clone(), move |doc_id: String, element_id: String| {
            d.prev(doc_id, element_id)
        })?,
    )?;

    Ok(())
}

const CHEERIO_POLYFILL: &str = r#"
var cheerio = {
    load: function(html) {
        var docId = __cheerio_load(html);
        var $ = function(selector, context) {
            if (selector && selector._elementIds) return selector;
            if (context && context._elementIds && context._elementIds.length > 0) {
                var allIds = [];
                for (var i = 0; i < context._elementIds.length; i++) {
                    var childIdsJson = __cheerio_find(docId, context._elementIds[i], selector);
                    var childIds = JSON.parse(childIdsJson);
                    allIds = allIds.concat(childIds);
                }
                return createCheerioWrapperFromIds(docId, allIds);
            }
            return createCheerioWrapper(docId, selector);
        };
        $.html = function(el) {
            if (el && el._elementIds && el._elementIds.length > 0) {
                return __cheerio_html(docId, el._elementIds[0]);
            }
            return __cheerio_html(docId, '');
        };
        return $;
    }
};

function createCheerioWrapper(docId, selector) {
    var elementIds;
    if (typeof selector === 'string') {
        var idsJson = __cheerio_select(docId, selector);
        elementIds = JSON.parse(idsJson);
    } else {
        elementIds = [];
    }
    return createCheerioWrapperFromIds(docId, elementIds);
}

function createCheerioWrapperFromIds(docId, ids) {
    var wrapper = {
        _docId: docId,
        _elementIds: ids,
        length: ids.length,
        each: function(callback) {
            for (var i = 0; i < ids.length; i++) {
                var elWrapper = createCheerioWrapperFromIds(docId, [ids[i]]);
                callback.call(elWrapper, i, elWrapper);
            }
            return wrapper;
        },
        find: function(sel) {
            var allIds = [];
            for (var i = 0; i < ids.length; i++) {
                var childIdsJson = __cheerio_find(docId, ids[i], sel);
                var childIds = JSON.parse(childIdsJson);
                allIds = allIds.concat(childIds);
            }
            return createCheerioWrapperFromIds(docId, allIds);
        },
        text: function() {
            if (ids.length === 0) return '';
            return __cheerio_text(docId, ids.join(','));
        },
        html: function() {
            if (ids.length === 0) return '';
            return __cheerio_inner_html(docId, ids[0]);
        },
        attr: function(name) {
            if (ids.length === 0) return undefined;
            var val = __cheerio_attr(docId, ids[0], name);
            return val === '__UNDEFINED__' ? undefined : val;
        },
        first: function() { return createCheerioWrapperFromIds(docId, ids.length > 0 ? [ids[0]] : []); },
        last: function() { return createCheerioWrapperFromIds(docId, ids.length > 0 ? [ids[ids.length - 1]] : []); },
        next: function() {
            var nextIds = [];
            for (var i = 0; i < ids.length; i++) {
                var nextId = __cheerio_next(docId, ids[i]);
                if (nextId && nextId !== '__NONE__') nextIds.push(nextId);
            }
            return createCheerioWrapperFromIds(docId, nextIds);
        },
        prev: function() {
            var prevIds = [];
            for (var i = 0; i < ids.length; i++) {
                var prevId = __cheerio_prev(docId, ids[i]);
                if (prevId && prevId !== '__NONE__') prevIds.push(prevId);
            }
            return createCheerioWrapperFromIds(docId, prevIds);
        },
        eq: function(index) {
            if (index >= 0 && index < ids.length) return createCheerioWrapperFromIds(docId, [ids[index]]);
            return createCheerioWrapperFromIds(docId, []);
        },
        get: function(index) {
            if (typeof index === 'number') {
                if (index >= 0 && index < ids.length) return createCheerioWrapperFromIds(docId, [ids[index]]);
                return undefined;
            }
            return ids.map(function(id) { return createCheerioWrapperFromIds(docId, [id]); });
        },
        map: function(callback) {
            var results = [];
            for (var i = 0; i < ids.length; i++) {
                var elWrapper = createCheerioWrapperFromIds(docId, [ids[i]]);
                var result = callback.call(elWrapper, i, elWrapper);
                if (result !== undefined && result !== null) results.push(result);
            }
            return {
                length: results.length,
                get: function(index) { return typeof index === 'number' ? results[index] : results; },
                toArray: function() { return results; }
            };
        },
        filter: function(selectorOrCallback) {
            if (typeof selectorOrCallback === 'function') {
                var filteredIds = [];
                for (var i = 0; i < ids.length; i++) {
                    var elWrapper = createCheerioWrapperFromIds(docId, [ids[i]]);
                    var result = selectorOrCallback.call(elWrapper, i, elWrapper);
                    if (result) filteredIds.push(ids[i]);
                }
                return createCheerioWrapperFromIds(docId, filteredIds);
            }
            return wrapper;
        },
        children: function(sel) { return this.find(sel || '*'); },
        parent: function() { return createCheerioWrapperFromIds(docId, []); },
        toArray: function() { return ids.map(function(id) { return createCheerioWrapperFromIds(docId, [id]); }); }
    };
    return wrapper;
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scraper_can_use_cheerio_and_module_exports_without_network() {
        let code = r#"
            module.exports.getStreams = async function(tmdbId, mediaType) {
                var $ = cheerio.load('<div class="row" data-q="1080p">Alpha</div>');
                var el = $('.row');
                return [{ title: el.attr('data-q'), url: 'https://example.com/' + tmdbId + '-' + mediaType }];
            };
        "#
        .to_string();

        let result =
            execute_scraper(code, "123".to_string(), "movie".to_string(), None, None).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed[0]["title"], "1080p");
        assert_eq!(parsed[0]["url"], "https://example.com/123-movie");
    }

    #[test]
    fn scraper_that_throws_returns_empty_array_instead_of_erroring() {
        let code = r#"
            module.exports.getStreams = async function() {
                throw new Error("boom");
            };
        "#
        .to_string();

        let result =
            execute_scraper(code, "1".to_string(), "movie".to_string(), None, None).unwrap();
        assert_eq!(result, "[]");
    }

    #[test]
    fn fetch_bridge_rejects_private_hosts() {
        let code = r#"
            module.exports.getStreams = async function() {
                var res = await fetch('http://127.0.0.1:9/secret');
                var parsed = await res.json();
                return [{ title: 'x', url: 'https://example.com/blocked', ok: res.ok }];
            };
        "#
        .to_string();

        let result =
            execute_scraper(code, "1".to_string(), "movie".to_string(), None, None).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed[0]["ok"], false);
    }
}
