use crate::DesktopState;
use fluxa_core::FluxaCore;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::State;

fn sanitize_file_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('.').trim_matches('_');
    if trimmed.is_empty() {
        "download.mp4".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

pub fn resolve_offline_dir(state: &DesktopState) -> Option<PathBuf> {
    if let Some(dir) = state.download_dir.lock().unwrap().clone() {
        return Some(dir);
    }
    let data_dir = state.data_dir.lock().unwrap().clone()?;
    Some(data_dir.join("offline"))
}

#[tauri::command]
pub fn set_download_dir(state: State<DesktopState>, path: Option<String>) -> Result<(), String> {
    *state.download_dir.lock().unwrap() = path.filter(|p| !p.is_empty()).map(PathBuf::from);
    Ok(())
}

#[tauri::command]
pub async fn enqueue_offline_download(
    state: State<'_, DesktopState>,
    request_json: String,
) -> Result<Option<String>, String> {
    let plan_json = FluxaCore::offline_download_plan_json(&request_json)
        .ok_or_else(|| "offline download plan could not be created".to_string())?;
    let plan: Value = serde_json::from_str(&plan_json)
        .map_err(|e| format!("invalid offline download plan: {e}"))?;
    if plan.get("supported").and_then(Value::as_bool) != Some(true) {
        return Ok(Some(plan_json));
    }
    let offline_dir = resolve_offline_dir(&state)
        .ok_or_else(|| "app data dir is not ready".to_string())?;
    fs::create_dir_all(&offline_dir).map_err(|e| e.to_string())?;
    let playback_url = plan
        .get("playbackUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "offline plan has no playback url".to_string())?;
    let video_file_name = plan
        .get("videoFileName")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "offline plan has no video file name".to_string())?;
    let safe_video_file_name = sanitize_file_name(&video_file_name);
    let target_path = offline_dir.join(&safe_video_file_name);
    let temp_path = offline_dir.join(format!("{safe_video_file_name}.part"));
    crate::net_guard::ensure_public_host(playback_url).await?;
    let mut response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 60))
        .build()
        .map_err(|e| e.to_string())?
        .get(playback_url)
        .header("User-Agent", "Fluxa/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }
    let mut file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if target_path.exists() {
        fs::remove_file(&target_path).map_err(|e| e.to_string())?;
    }
    fs::rename(&temp_path, &target_path).map_err(|e| e.to_string())?;
    let mut completed = plan;
    completed["status"] = json!("downloaded");
    completed["path"] = json!(target_path.to_string_lossy().to_string());
    completed["videoFileName"] = json!(safe_video_file_name);
    serde_json::to_string(&completed)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_offline_downloads(state: State<DesktopState>) -> Vec<Value> {
    let offline_dir = match resolve_offline_dir(&state) {
        Some(d) => d,
        None => return vec![],
    };
    if !offline_dir.exists() {
        return vec![];
    }
    let entries = match fs::read_dir(&offline_dir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut items: Vec<Value> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("part") {
                return None;
            }
            let metadata = fs::metadata(&path).ok()?;
            let size = metadata.len();
            let name = path.file_name()?.to_string_lossy().to_string();
            Some(json!({
                "id": name.clone(),
                "videoFileName": name,
                "path": path.to_string_lossy().to_string(),
                "sizeBytes": size,
                "status": "downloaded",
            }))
        })
        .collect();
    items.sort_by(|a, b| {
        a["videoFileName"]
            .as_str()
            .unwrap_or("")
            .cmp(b["videoFileName"].as_str().unwrap_or(""))
    });
    items
}

#[tauri::command]
pub fn delete_offline_download(state: State<DesktopState>, file_name: String) -> Result<(), String> {
    let offline_dir = resolve_offline_dir(&state)
        .ok_or_else(|| "app data dir not ready".to_string())?;
    let safe_name = sanitize_file_name(&file_name);
    let path = offline_dir.join(&safe_name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
