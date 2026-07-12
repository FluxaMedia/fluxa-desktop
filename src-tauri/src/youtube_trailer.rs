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
    let stream_url = payload.pointer("/streamingData/hlsManifestUrl")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| first_direct_url(payload.pointer("/streamingData/formats")))
        .or_else(|| first_direct_url(payload.pointer("/streamingData/adaptiveFormats")))?;
    let subtitles = payload.pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(Value::as_array)
        .map(|tracks| tracks.iter().filter_map(caption_track).collect::<Vec<_>>())
        .unwrap_or_default();
    Some(json!({ "status": "ok", "streamUrl": stream_url, "subtitles": subtitles }))
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
