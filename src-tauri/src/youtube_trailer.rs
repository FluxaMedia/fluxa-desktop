use serde_json::{json, Value};

const PLAYER_URL: &str = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

pub async fn resolve(video_id: &str) -> Option<Value> {
    let body = json!({
        "videoId": video_id,
        "context": {
            "client": {
                "clientName": "ANDROID",
                "clientVersion": "20.10.38",
                "androidSdkVersion": 35
            }
        }
    });
    let response = reqwest::Client::new()
        .post(PLAYER_URL)
        .header("User-Agent", "com.google.android.youtube/20.10.38 (Linux; U; Android 15) gzip")
        .header("X-YouTube-Client-Name", "3")
        .header("X-YouTube-Client-Version", "20.10.38")
        .json(&body)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload: Value = response.json().await.ok()?;
    if payload.pointer("/playabilityStatus/status").and_then(Value::as_str) != Some("OK") {
        return None;
    }
    let stream_url = match payload.pointer("/streamingData/hlsManifestUrl").and_then(Value::as_str) {
        Some(master_url) => Some(best_hls_variant(master_url).await.unwrap_or_else(|| master_url.to_owned())),
        None => None,
    }
        .or_else(|| first_direct_url(payload.pointer("/streamingData/formats")))
        .or_else(|| first_direct_url(payload.pointer("/streamingData/adaptiveFormats")))?;
    let subtitles = payload.pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(Value::as_array)
        .map(|tracks| tracks.iter().filter_map(caption_track).collect::<Vec<_>>())
        .unwrap_or_default();
    Some(json!({ "status": "ok", "streamUrl": stream_url, "subtitles": subtitles }))
}

async fn best_hls_variant(master_url: &str) -> Option<String> {
    let manifest = reqwest::Client::new()
        .get(master_url)
        .header("Accept", "application/vnd.apple.mpegurl, application/x-mpegURL, */*")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .await
        .ok()?;
    let base = reqwest::Url::parse(master_url).ok()?;
    let mut attributes: Option<&str> = None;
    let mut best: Option<(i64, i64, String)> = None;
    for line in manifest.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(value) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            attributes = Some(value);
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        let Some(stream_attributes) = attributes.take() else {
            continue;
        };
        if stream_attributes.contains("AUDIO=") {
            continue;
        }
        let pixels = resolution_pixels(stream_attributes);
        let bandwidth = numeric_attribute(stream_attributes, "BANDWIDTH");
        let url = base.join(line).ok()?.to_string();
        if best.as_ref().is_none_or(|current| pixels > current.0 || (pixels == current.0 && bandwidth > current.1)) {
            best = Some((pixels, bandwidth, url));
        }
    }
    best.map(|(_, _, url)| url)
}

fn resolution_pixels(attributes: &str) -> i64 {
    let Some(value) = attributes.split(',').find_map(|part| part.strip_prefix("RESOLUTION=")) else {
        return 0;
    };
    let mut dimensions = value.split('x');
    dimensions.next().and_then(|width| width.parse::<i64>().ok()).unwrap_or(0)
        * dimensions.next().and_then(|height| height.parse::<i64>().ok()).unwrap_or(0)
}

fn numeric_attribute(attributes: &str, key: &str) -> i64 {
    attributes.split(',')
        .find_map(|part| part.strip_prefix(&format!("{key}=")))
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
}

fn first_direct_url(formats: Option<&Value>) -> Option<String> {
    formats?.as_array()?.iter()
        .find_map(|format| format.get("url").and_then(Value::as_str).map(str::to_owned))
}

fn caption_track(track: &Value) -> Option<Value> {
    let url = track.get("baseUrl")?.as_str()?;
    Some(json!({
        "languageTag": track.get("languageCode").and_then(Value::as_str).unwrap_or("und"),
        "label": track.pointer("/name/simpleText").and_then(Value::as_str).or_else(|| track.get("languageCode").and_then(Value::as_str)).unwrap_or(""),
        "url": url,
        "mimeType": "text/vtt",
        "isAuto": track.get("kind").and_then(Value::as_str) == Some("asr")
    }))
}
