use serde_json::json;

const TRAKT_CLIENT_ID: &str = env!("FLUXA_TRAKT_CLIENT_ID");
const TRAKT_CLIENT_SECRET: &str = env!("FLUXA_TRAKT_CLIENT_SECRET");
pub const MAL_CLIENT_ID: &str = env!("FLUXA_MAL_CLIENT_ID");
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
    let url = format!("{NUVIO_SUPABASE_URL}{path}");
    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
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

fn url_encode(s: &str) -> String {
    let mut encoded = String::new();
    for byte in s.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char);
            }
            b => {
                encoded.push('%');
                encoded.push(
                    char::from_digit((b >> 4) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
                encoded.push(
                    char::from_digit((b & 0xf) as u32, 16)
                        .unwrap()
                        .to_ascii_uppercase(),
                );
            }
        }
    }
    encoded
}

#[tauri::command]
pub fn get_oauth_client_id(service: &str) -> &'static str {
    match service {
        "trakt" => TRAKT_CLIENT_ID,
        "mal" => MAL_CLIENT_ID,
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
        return Err(format!("Trakt token exchange failed: HTTP {status}: {text}"));
    }
    Ok(text)
}

#[tauri::command]
pub async fn mal_oauth_exchange(code: String, code_verifier: String) -> Result<String, String> {
    let body = format!(
        "client_id={}&grant_type=authorization_code&code={}&redirect_uri={}&code_verifier={}",
        url_encode(MAL_CLIENT_ID),
        url_encode(&code),
        url_encode("fluxa://oauth/mal"),
        url_encode(&code_verifier),
    );
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .post("https://myanimelist.net/v1/oauth2/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("MAL token exchange failed: HTTP {status}: {text}"));
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
        return Err(format!("SIMKL token exchange failed: HTTP {status}: {text}"));
    }
    Ok(text)
}
