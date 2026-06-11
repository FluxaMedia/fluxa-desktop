use crate::DesktopState;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::State;

pub fn sanitize_key(key: &str) -> String {
    key.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn write_file_atomic(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn storage_read(state: State<DesktopState>, key: String) -> Option<String> {
    let dir = state.data_dir.lock().unwrap().clone()?;
    let path = dir.join(format!("{}.json", sanitize_key(&key)));
    fs::read_to_string(path).ok()
}

#[tauri::command]
pub fn storage_write(state: State<DesktopState>, key: String, value: String) -> bool {
    let dir = match state.data_dir.lock().unwrap().clone() {
        Some(d) => d,
        None => return false,
    };
    if fs::create_dir_all(&dir).is_err() {
        return false;
    }
    let path = dir.join(format!("{}.json", sanitize_key(&key)));
    write_file_atomic(&path, value.as_bytes()).is_ok()
}

#[tauri::command]
pub fn storage_delete(state: State<DesktopState>, key: String) -> bool {
    let dir = match state.data_dir.lock().unwrap().clone() {
        Some(d) => d,
        None => return false,
    };
    let path = dir.join(format!("{}.json", sanitize_key(&key)));
    fs::remove_file(path).is_ok()
}
