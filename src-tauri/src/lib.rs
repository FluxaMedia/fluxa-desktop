use fluxa_core::FluxaCore;
mod airplay;
mod artwork;
mod cast;
mod cast_proxy;
mod chromecast;
mod discord_presence;
mod downloads;
#[cfg(target_os = "linux")]
mod linux_player_surface;
#[cfg(target_os = "macos")]
mod macos_player_surface;
mod mpv_render;
mod net_guard;
mod oauth;
mod player;
mod roku;
mod storage;
#[cfg(target_os = "windows")]
mod windows_egl;
#[cfg(target_os = "windows")]
mod windows_player_surface;

use airplay::*;
use cast::*;
use cast_proxy::*;
use chromecast::*;
use discord_presence::*;
use downloads::*;
use oauth::*;
use player::*;
use roku::*;
use storage::*;

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(serde::Serialize)]
struct HttpTextResponse {
    status_code: u16,
    body: String,
}

pub struct DesktopState {
    pub engine_handle: Mutex<Option<u64>>,
    pub data_dir: Mutex<Option<PathBuf>>,
    pub download_dir: Mutex<Option<PathBuf>>,
    pub player_renderer: Mutex<Option<mpv_render::MpvRenderer>>,
    #[cfg(target_os = "linux")]
    pub native_player_surface: Mutex<Option<linux_player_surface::NativePlayerSurface>>,
    #[cfg(target_os = "windows")]
    pub native_player_surface: Mutex<Option<windows_player_surface::NativePlayerSurface>>,
    #[cfg(target_os = "macos")]
    pub native_player_surface: Mutex<Option<macos_player_surface::NativePlayerSurface>>,
    pub chapters_json: Mutex<Option<String>>,
    pub skip_segments_json: Mutex<Option<String>>,
    pub next_ep_subtitle: Mutex<String>,
    pub next_ep_threshold_percent: Mutex<f64>,
    pub auto_play_next_episode: Mutex<bool>,
    pub auto_play_countdown_secs: Mutex<u32>,
    pub auto_skip_segments: Mutex<bool>,
    pub eof_next_fired: Mutex<bool>,
    pub episodes_json: Mutex<Option<String>>,
    pub thumb_url: Mutex<Option<String>>,
    pub seek_thumbnail_enabled: Mutex<bool>,
    pub thumbnail_renderer: Mutex<Option<mpv_render::MpvRenderer>>,
    pub thumbnail_loaded_url: Mutex<Option<String>>,
    pub pending_hide: AtomicBool,
    #[cfg(target_os = "windows")]
    pub main_window_size: std::sync::atomic::AtomicU64,
    pub downloads: downloads::DownloadsState,
    pub torrent_server_base_url: Mutex<Option<String>>,
    pub torrent_stream_link: Mutex<Option<String>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            engine_handle: Mutex::new(None),
            data_dir: Mutex::new(None),
            download_dir: Mutex::new(None),
            player_renderer: Mutex::new(None),
            #[cfg(target_os = "linux")]
            native_player_surface: Mutex::new(None),
            #[cfg(target_os = "windows")]
            native_player_surface: Mutex::new(None),
            #[cfg(target_os = "macos")]
            native_player_surface: Mutex::new(None),
            chapters_json: Mutex::new(None),
            skip_segments_json: Mutex::new(None),
            next_ep_subtitle: Mutex::new(String::new()),
            next_ep_threshold_percent: Mutex::new(85.0),
            auto_play_next_episode: Mutex::new(true),
            auto_play_countdown_secs: Mutex::new(7),
            auto_skip_segments: Mutex::new(false),
            eof_next_fired: Mutex::new(false),
            episodes_json: Mutex::new(None),
            thumb_url: Mutex::new(None),
            seek_thumbnail_enabled: Mutex::new(false),
            thumbnail_renderer: Mutex::new(None),
            thumbnail_loaded_url: Mutex::new(None),
            pending_hide: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            main_window_size: std::sync::atomic::AtomicU64::new(0),
            downloads: downloads::DownloadsState::default(),
            torrent_server_base_url: Mutex::new(None),
            torrent_stream_link: Mutex::new(None),
        }
    }
}

#[tauri::command]
fn debug_log(msg: String) {
    if std::env::var_os("FLUXA_DEBUG_LOGS").is_some() {
        println!("[perf] {msg}");
    }
}

#[tauri::command]
fn engine_init(state: State<DesktopState>, initial_json: String) -> u64 {
    let handle = FluxaCore::create_headless_engine(&initial_json);
    *state.engine_handle.lock().unwrap() = Some(handle);
    handle
}

#[tauri::command]
fn engine_dispatch(state: State<DesktopState>, action_json: String) -> Option<String> {
    let handle = { *state.engine_handle.lock().unwrap() }?;
    FluxaCore::headless_engine_dispatch_json(handle, &action_json)
}

#[tauri::command]
fn engine_complete_effect(state: State<DesktopState>, result_json: String) -> Option<String> {
    let handle = { *state.engine_handle.lock().unwrap() }?;
    FluxaCore::headless_engine_complete_effect_json(handle, &result_json)
}

#[tauri::command]
fn engine_snapshot(state: State<DesktopState>) -> Option<String> {
    let handle = { *state.engine_handle.lock().unwrap() }?;
    FluxaCore::headless_engine_snapshot_json(handle)
}

#[tauri::command]
async fn http_fetch_text(url: String) -> Result<HttpTextResponse, String> {
    net_guard::ensure_public_host(&url).await?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .header("User-Agent", "Fluxa/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status_code = response.status().as_u16();
    let body = response.text().await.map_err(|e| e.to_string())?;
    Ok(HttpTextResponse { status_code, body })
}

#[tauri::command]
fn core_invoke(method: String, args_json: String) -> String {
    fluxa_core::ffi::core_invoke(&method, &args_json)
}

fn start_torrent_stream_inner(
    data_dir: std::path::PathBuf,
    stream_json: String,
    title: Option<String>,
    preferences: Option<Value>,
) -> Result<(String, String, String), String> {
    let cache_dir = data_dir.join("torrent-cache");
    let server_json =
        fluxa_streaming_engine::start_torrent_server(&cache_dir.to_string_lossy(), 0, "")
            .ok_or_else(|| "failed to start torrent server".to_string())?;
    let server: Value = serde_json::from_str(&server_json)
        .map_err(|e| format!("invalid torrent server response: {e}"))?;
    let base_url = server
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| "torrent server did not return url".to_string())?;
    apply_torrent_preferences(base_url, preferences.as_ref());

    let stream: Value =
        serde_json::from_str(&stream_json).map_err(|e| format!("invalid stream json: {e}"))?;
    let playback_json = FluxaCore::stream_playback_info_json(&stream_json)
        .ok_or_else(|| "stream playback info could not be resolved".to_string())?;
    let playback: Value =
        serde_json::from_str(&playback_json).map_err(|e| format!("invalid playback info: {e}"))?;
    let link = playback
        .get("playableUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "torrent stream has no playable link".to_string())?;
    let requested_file_idx = stream
        .get("fileIdx")
        .and_then(Value::as_i64)
        .map(|v| v as i32);
    let preferred_filename = stream
        .get("behaviorHints")
        .and_then(|hints| hints.get("filename"))
        .and_then(Value::as_str)
        .or_else(|| stream.get("filename").and_then(Value::as_str));
    let sources = stream
        .get("sources")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default();

    let runtime_request = json!({
        "link": link,
        "title": title
            .or_else(|| stream.get("title").and_then(Value::as_str).map(str::to_string))
            .or_else(|| stream.get("name").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| "Fluxa stream".to_string()),
        "requestedFileIdx": requested_file_idx,
        "preferredFilename": preferred_filename,
        "sources": sources,
        "fileStats": [],
        "rejectedIndex": Value::Null,
        "baseUrl": base_url,
        "play": true,
        "stat": false
    });
    let runtime_json = FluxaCore::torrent_runtime_info_json(&runtime_request.to_string())
        .ok_or_else(|| "torrent runtime info could not be resolved".to_string())?;
    let runtime: Value = serde_json::from_str(&runtime_json)
        .map_err(|e| format!("invalid torrent runtime response: {e}"))?;
    let stream_url = runtime
        .get("streamUrl")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "torrent runtime did not return streamUrl".to_string())?;
    Ok((stream_url, base_url.to_string(), link.to_string()))
}

#[tauri::command]
async fn start_torrent_stream(
    state: State<'_, DesktopState>,
    stream_json: String,
    title: Option<String>,
    preferences: Option<Value>,
) -> Result<String, String> {
    let data_dir = state
        .data_dir
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "app data dir is not ready".to_string())?;
    let (stream_url, base_url, link) = tauri::async_runtime::spawn_blocking(move || {
        start_torrent_stream_inner(data_dir, stream_json, title, preferences)
    })
    .await
    .map_err(|e| e.to_string())??;
    *state.torrent_server_base_url.lock().unwrap() = Some(base_url);
    *state.torrent_stream_link.lock().unwrap() = Some(link);
    Ok(stream_url)
}

#[tauri::command]
async fn stop_torrent_stream(state: State<'_, DesktopState>) -> Result<bool, String> {
    *state.torrent_server_base_url.lock().unwrap() = None;
    *state.torrent_stream_link.lock().unwrap() = None;
    Ok(tauri::async_runtime::spawn_blocking(fluxa_streaming_engine::stop_torrent_server)
        .await
        .unwrap_or(false))
}

#[tauri::command]
async fn player_torrent_stats(state: State<'_, DesktopState>) -> Result<Option<Value>, String> {
    let base_url = state.torrent_server_base_url.lock().unwrap().clone();
    let link = state.torrent_stream_link.lock().unwrap().clone();
    let (Some(base_url), Some(link)) = (base_url, link) else {
        return Ok(None);
    };
    let url = format!("{}/torrents", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&serde_json::json!({ "action": "get", "link": link }))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json_val = response.json::<Value>().await.map_err(|e| e.to_string())?;
    Ok(Some(json_val))
}

fn apply_torrent_preferences(base_url: &str, preferences: Option<&Value>) {
    let preset = preferences
        .and_then(|p| p.get("torrentSpeedPreset"))
        .and_then(Value::as_str)
        .unwrap_or("default");
    let preload_size = match preset {
        "fast" => 32,
        "ultra_fast" => 64,
        _ => 16,
    };
    let url = format!("{}/settings", base_url.trim_end_matches('/'));
    let body = json!({ "PreloadSize": preload_size }).to_string();
    std::thread::spawn(move || {
        let Some(rest) = url.strip_prefix("http://") else {
            return;
        };
        let (authority, path) = rest.split_once('/').unwrap_or((rest, "settings"));
        let (host, port) = authority
            .split_once(':')
            .and_then(|(host, port)| port.parse::<u16>().ok().map(|port| (host, port)))
            .unwrap_or((authority, 80));
        let path = format!("/{path}");
        let Ok(mut stream) = std::net::TcpStream::connect((host, port)) else {
            return;
        };
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = std::io::Write::write_all(&mut stream, request.as_bytes());
    });
}

#[tauri::command]
fn get_data_dir(state: State<DesktopState>) -> Option<String> {
    state
        .data_dir
        .lock()
        .unwrap()
        .as_ref()
        .map(|d| d.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var("MPV_LIBMPV_RENDER_BACKEND", "gpu-next");
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_libmpv::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in &args {
                if !arg.starts_with("fluxa://") {
                    continue;
                }
                let query = arg.split('?').nth(1);
                let code = query
                    .and_then(|q| q.split('&').find(|p| p.starts_with("code=")))
                    .map(|p| p.trim_start_matches("code=").to_string());
                let state = query
                    .and_then(|q| q.split('&').find(|p| p.starts_with("state=")))
                    .map(|p| p.trim_start_matches("state=").to_string());
                if let Some(code) = code {
                    let evt = if arg.contains("/trakt") {
                        "trakt-oauth-code"
                    } else if arg.contains("/anilist") {
                        "anilist-oauth-code"
                    } else if arg.contains("/simkl") {
                        "simkl-oauth-code"
                    } else {
                        continue;
                    };
                    let _ = app.emit(evt, json!({ "code": code, "state": state }));
                }
            }
        }))
        .plugin({
            let log_level = if std::env::var_os("FLUXA_DEBUG_LOGS").is_some() {
                log::LevelFilter::Debug
            } else {
                log::LevelFilter::Warn
            };

            tauri_plugin_log::Builder::new()
                .level(log_level)
                .level_for("librqbit", log::LevelFilter::Off)
                .level_for("librqbit_dht", log::LevelFilter::Off)
                .level_for("librqbit_tracker_comms", log::LevelFilter::Off)
                .level_for("librqbit_upnp", log::LevelFilter::Off)
                .level_for("librqbit_core", log::LevelFilter::Off)
                .level_for("librqbit_peer_protocol", log::LevelFilter::Off)
                .level_for("tracing::span", log::LevelFilter::Off)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .build()
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(DesktopState::default())
        .manage(discord_presence::DiscordPresenceState::default())
        .manage(cast::CastState::default())
        .manage(chromecast::ChromecastState::default())
        .manage(airplay::AirplayState::default())
        .manage(roku::RokuState::default())
        .manage(cast_proxy::CastProxyState::default())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
                .join("fluxa");

            let state = app.state::<DesktopState>();
            *state.data_dir.lock().unwrap() = Some(data_dir.clone());
            let _ = fs::create_dir_all(&data_dir);

            if let Ok(cache_dir) = app.path().app_cache_dir() {
                std::thread::spawn(move || {
                    if let Ok(entries) = fs::read_dir(&cache_dir) {
                        for entry in entries.flatten() {
                            let name = entry.file_name();
                            let name = name.to_string_lossy();
                            if name.starts_with("gc_")
                                && (name.ends_with(".mp4")
                                    || name.ends_with(".webm")
                                    || name.ends_with(".gif")
                                    || name.ends_with(".webp"))
                            {
                                let _ = fs::remove_file(entry.path());
                            }
                        }
                    }
                });
            }

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let s = url.as_str();
                    let code = url
                        .query_pairs()
                        .find(|(k, _)| k == "code")
                        .map(|(_, v)| v.into_owned());
                    let state = url
                        .query_pairs()
                        .find(|(k, _)| k == "state")
                        .map(|(_, v)| v.into_owned());
                    if let Some(code) = code {
                        let evt = if s.contains("/trakt") {
                            "trakt-oauth-code"
                        } else if s.contains("/anilist") {
                            "anilist-oauth-code"
                        } else if s.contains("/simkl") {
                            "simkl-oauth-code"
                        } else {
                            continue;
                        };
                        let _ = handle.emit(evt, json!({ "code": code, "state": state }));
                    }
                }
            });

            #[cfg(target_os = "windows")]
            if let Some(main_window) = app.get_webview_window("main") {
                let store_size = |window: &tauri::WebviewWindow| {
                    if let Ok(size) = window.inner_size() {
                        let state = window.state::<DesktopState>();
                        let packed = ((size.width.max(2) as u64) << 32) | (size.height.max(2) as u64);
                        state
                            .main_window_size
                            .store(packed, std::sync::atomic::Ordering::Release);
                    }
                };
                store_size(&main_window);
                let window_for_event = main_window.clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Resized(_) = event {
                        store_size(&window_for_event);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            debug_log,
            engine_init,
            engine_dispatch,
            engine_complete_effect,
            engine_snapshot,
            http_fetch_text,
            storage_read,
            storage_write,
            storage_delete,
            core_invoke,
            start_torrent_stream,
            stop_torrent_stream,
            player_init,
            player_apply_preferences,
            player_set_http_headers,
            player_load,
            player_render_frame,
            player_command,
            player_show_loading,
            player_hide,
            player_set_title,
            player_set_loading_artwork,
            player_prefetch_artwork,
            enqueue_offline_download,
            player_add_subtitle,
            player_title,
            player_status,
            player_destroy,
            player_get_playback_info,
            player_track_options,
            player_set_seek_thumbnail_enabled,
            player_get_seek_thumbnail,
            player_screenshot,
            player_set_chapters,
            player_clear_chapters,
            player_set_skip_info,
            player_clear_skip_info,
            player_set_episodes,
            player_clear_episodes,
            get_oauth_client_id,
            nuvio_request,
            trakt_device_start,
            trakt_device_poll,
            trakt_oauth_exchange,
            anilist_oauth_exchange,
            anilist_oauth_refresh,
            simkl_oauth_exchange,
            get_data_dir,
            set_download_dir,
            list_offline_downloads,
            delete_offline_download,
            pause_offline_download,
            resume_offline_download,
            cancel_offline_download,
            discord_presence_configure,
            discord_presence_update,
            discord_presence_set_idle,
            discord_presence_clear,
            cast_discover_devices,
            cast_resolve_media_url,
            cast_set_media,
            cast_play,
            cast_pause,
            cast_seek,
            cast_set_volume,
            cast_disconnect,
            chromecast_discover_devices,
            chromecast_connect,
            chromecast_play,
            chromecast_pause,
            chromecast_seek,
            chromecast_set_volume,
            chromecast_disconnect,
            airplay_discover_devices,
            airplay_set_media,
            airplay_play,
            airplay_pause,
            airplay_seek,
            airplay_set_volume,
            airplay_disconnect,
            roku_discover_devices,
            roku_set_media,
            roku_play_pause,
            roku_disconnect,
            cast_proxy_serve,
            player_torrent_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fluxa Desktop");
}
