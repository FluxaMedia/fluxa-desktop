use serde_json::json;

const TRAKT_CLIENT_ID: &str = env!("FLUXA_TRAKT_CLIENT_ID");
const TRAKT_CLIENT_SECRET: &str = env!("FLUXA_TRAKT_CLIENT_SECRET");
const ANILIST_CLIENT_ID: &str = match option_env!("FLUXA_ANILIST_CLIENT_ID") {
    Some(value) => value,
    None => "",
};
const ANILIST_CLIENT_SECRET: &str = match option_env!("FLUXA_ANILIST_CLIENT_SECRET") {
    Some(value) => value,
    None => "",
};
pub const SIMKL_CLIENT_ID: &str = env!("FLUXA_SIMKL_CLIENT_ID");
const SIMKL_CLIENT_SECRET: &str = env!("FLUXA_SIMKL_CLIENT_SECRET");
const NUVIO_SUPABASE_URL: &str = env!("FLUXA_NUVIO_SUPABASE_URL");
const NUVIO_SUPABASE_KEY: &str = env!("FLUXA_NUVIO_SUPABASE_KEY");

// Proxies Nuvio/Supabase REST calls so the anon key stays on the Rust side --
// JS only ever sees response bodies, never the key itself.
#[tauri::command]
pub async fn nuvio_request(
    method: String,
    path: String,
    body: Option<String>,
    token: Option<String>,
) -> Result<(u16, String), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}{}", NUVIO_SUPABASE_URL.trim_end_matches('/'), path);
    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        other => return Err(format!("unsupported method: {other}")),
    };
    req = req
        .header("apikey", NUVIO_SUPABASE_KEY)
        .header("Content-Type", "application/json");
    if let Some(token) = &token {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    req = match &body {
        Some(body) => req.body(body.clone()),
        None if method == "POST" => req.body("{}"),
        None => req,
    };
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok((status, text))
}

fn trakt_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Fluxa Desktop/1.0")
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert("Content-Type", "application/json".parse().unwrap());
            h.insert("trakt-api-version", "2".parse().unwrap());
            h.insert("trakt-api-key", TRAKT_CLIENT_ID.parse().unwrap());
            h
        })
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_oauth_client_id(service: &str) -> &'static str {
    match service {
        "trakt" => TRAKT_CLIENT_ID,
        "anilist" => ANILIST_CLIENT_ID,
        "simkl" => SIMKL_CLIENT_ID,
        _ => "",
    }
}

#[tauri::command]
pub async fn trakt_device_start() -> Result<String, String> {
    let res = trakt_client()?
        .post("https://api.trakt.tv/oauth/device/code")
        .json(&json!({ "client_id": TRAKT_CLIENT_ID }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Trakt device code request failed: HTTP {status}"));
    }
    Ok(text)
}

#[tauri::command]
pub async fn trakt_device_poll(device_code: String) -> Result<String, String> {
    let res = trakt_client()?
        .post("https://api.trakt.tv/oauth/device/token")
        .json(&json!({ "code": device_code, "client_id": TRAKT_CLIENT_ID }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    match res.status().as_u16() {
        200 => Ok(res.text().await.map_err(|e| e.to_string())?),
        400 | 429 => Ok("pending".to_string()),
        _ => Err("expired".to_string()),
    }
}

#[tauri::command]
pub async fn trakt_oauth_exchange(code: String) -> Result<String, String> {
    let res = trakt_client()?
        .post("https://api.trakt.tv/oauth/token")
        .json(&serde_json::json!({
            "code": code,
            "client_id": TRAKT_CLIENT_ID,
            "client_secret": TRAKT_CLIENT_SECRET,
            "redirect_uri": "fluxa://oauth/trakt",
            "grant_type": "authorization_code",
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Trakt token exchange failed: HTTP {status}: {text}"
        ));
    }
    Ok(text)
}

#[tauri::command]
pub async fn anilist_oauth_exchange(code: String) -> Result<String, String> {
    if ANILIST_CLIENT_ID.is_empty() || ANILIST_CLIENT_SECRET.is_empty() {
        return Err("AniList OAuth client is not configured".to_string());
    }
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .post("https://anilist.co/api/v2/oauth/token")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "authorization_code",
            "client_id": ANILIST_CLIENT_ID,
            "client_secret": ANILIST_CLIENT_SECRET,
            "redirect_uri": "fluxa://oauth/anilist",
            "code": code,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "AniList token exchange failed: HTTP {status}: {text}"
        ));
    }
    Ok(text)
}

#[tauri::command]
pub async fn anilist_oauth_refresh(refresh_token: String) -> Result<String, String> {
    if ANILIST_CLIENT_ID.is_empty() || ANILIST_CLIENT_SECRET.is_empty() {
        return Err("AniList OAuth client is not configured".to_string());
    }
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .post("https://anilist.co/api/v2/oauth/token")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": ANILIST_CLIENT_ID,
            "client_secret": ANILIST_CLIENT_SECRET,
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "AniList token refresh failed: HTTP {status}: {text}"
        ));
    }
    Ok(text)
}

#[tauri::command]
pub async fn simkl_oauth_exchange(code: String) -> Result<String, String> {
    let body = serde_json::json!({
        "code": code,
        "client_id": SIMKL_CLIENT_ID,
        "client_secret": SIMKL_CLIENT_SECRET,
        "redirect_uri": "fluxa://oauth/simkl",
        "grant_type": "authorization_code",
    });
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .post("https://api.simkl.com/oauth/token")
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "SIMKL token exchange failed: HTTP {status}: {text}"
        ));
    }
    Ok(text)
}
