use crate::DesktopState;
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
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

// Files written before this existed are plain JSON with no magic prefix -- storage_read
// falls back to reading those as-is so upgrading doesn't wipe existing profiles/library.
const MAGIC: &[u8] = b"FXE1";

fn key_file_path(dir: &Path) -> PathBuf {
    dir.join(".storage_key")
}

fn load_or_create_key(dir: &Path) -> Result<Key<Aes256Gcm>, String> {
    let path = key_file_path(dir);
    if let Ok(bytes) = fs::read(&path) {
        if bytes.len() == 32 {
            return Ok(*Key::<Aes256Gcm>::from_slice(&bytes));
        }
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let key = Aes256Gcm::generate_key(&mut OsRng);
    fs::write(&path, key.as_slice()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn encrypt(dir: &Path, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let key = load_or_create_key(dir)?;
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(MAGIC.len() + nonce.len() + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt_or_legacy(dir: &Path, bytes: &[u8]) -> Option<String> {
    if !bytes.starts_with(MAGIC) {
        return String::from_utf8(bytes.to_vec()).ok();
    }
    let key = load_or_create_key(dir).ok()?;
    let cipher = Aes256Gcm::new(&key);
    let rest = &bytes[MAGIC.len()..];
    if rest.len() < 12 {
        return None;
    }
    let (nonce_bytes, ciphertext) = rest.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;
    String::from_utf8(plaintext).ok()
}

#[tauri::command]
pub fn storage_read(state: State<DesktopState>, key: String) -> Option<String> {
    let dir = state.data_dir.lock().unwrap().clone()?;
    let path = dir.join(format!("{}.json", sanitize_key(&key)));
    let bytes = fs::read(path).ok()?;
    decrypt_or_legacy(&dir, &bytes)
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
    let encrypted = match encrypt(&dir, value.as_bytes()) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    let path = dir.join(format!("{}.json", sanitize_key(&key)));
    write_file_atomic(&path, &encrypted).is_ok()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir() -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("fluxa-storage-test-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trips_through_encryption() {
        let dir = tmp_dir();
        let encrypted = encrypt(&dir, b"{\"token\":\"secret\"}").unwrap();
        assert!(encrypted.starts_with(MAGIC));
        assert_eq!(decrypt_or_legacy(&dir, &encrypted).unwrap(), "{\"token\":\"secret\"}");
    }

    #[test]
    fn falls_back_to_legacy_plaintext_without_magic_prefix() {
        let dir = tmp_dir();
        let legacy = b"{\"token\":\"secret\"}".to_vec();
        assert_eq!(decrypt_or_legacy(&dir, &legacy).unwrap(), "{\"token\":\"secret\"}");
    }

    #[test]
    fn reuses_the_same_key_across_calls() {
        let dir = tmp_dir();
        let a = encrypt(&dir, b"first").unwrap();
        let b = encrypt(&dir, b"second").unwrap();
        assert_eq!(decrypt_or_legacy(&dir, &a).unwrap(), "first");
        assert_eq!(decrypt_or_legacy(&dir, &b).unwrap(), "second");
    }
}
