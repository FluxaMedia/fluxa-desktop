use crate::artwork::{
    artwork_bg_decoded, artwork_logo_decoded,
    fetch_player_artwork_bytes_owned, normalize_url,
    scale_artwork_cover, scale_artwork_fit,
};
use crate::mpv_render;
use crate::DesktopState;
use fluxa_core::FluxaCore;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, State};

#[cfg(target_os = "linux")]
use crate::linux_player_surface;
#[cfg(target_os = "windows")]
use crate::windows_player_surface;
#[cfg(target_os = "macos")]
use crate::macos_player_surface;

#[cfg(target_os = "linux")]
pub fn ensure_native_player_surface(
    app_handle: &AppHandle,
    state: &DesktopState,
) -> Option<linux_player_surface::NativePlayerSurface> {
    if let Some(surface) = state.native_player_surface.lock().unwrap().clone() {
        return Some(surface);
    }
    match linux_player_surface::install(app_handle.clone()) {
        Ok(surface) => {
            *state.native_player_surface.lock().unwrap() = Some(surface.clone());
            Some(surface)
        }
        Err(error) => {
            log::warn!("native OpenGL player surface was not installed: {error}");
            None
        }
    }
}

#[cfg(target_os = "windows")]
pub fn ensure_native_player_surface(
    app_handle: &AppHandle,
    state: &DesktopState,
) -> Option<windows_player_surface::NativePlayerSurface> {
    if let Some(surface) = state.native_player_surface.lock().unwrap().clone() {
        return Some(surface);
    }
    match windows_player_surface::install(app_handle.clone()) {
        Ok(surface) => {
            *state.native_player_surface.lock().unwrap() = Some(surface.clone());
            Some(surface)
        }
        Err(error) => {
            log::warn!("native OpenGL player surface was not installed: {error}");
            None
        }
    }
}

#[cfg(target_os = "macos")]
pub fn ensure_native_player_surface(
    app_handle: &AppHandle,
    state: &DesktopState,
) -> Option<macos_player_surface::NativePlayerSurface> {
    if let Some(surface) = state.native_player_surface.lock().unwrap().clone() {
        return Some(surface);
    }
    match macos_player_surface::install(app_handle.clone()) {
        Ok(surface) => {
            *state.native_player_surface.lock().unwrap() = Some(surface.clone());
            Some(surface)
        }
        Err(error) => {
            log::warn!("native OpenGL player surface was not installed: {error}");
            None
        }
    }
}

fn mpv_options_from_preferences(preferences: &serde_json::Value) -> Vec<(String, String)> {
    let mut options = Vec::new();
    let get = |key: &str| preferences.get(key).and_then(|v| v.as_str());

    if let Some(speed) = get("playbackSpeed").and_then(|v| v.parse::<f64>().ok()) {
        if (0.25..=4.0).contains(&speed) {
            options.push(("speed".to_string(), format!("{speed:.2}")));
        }
    }
    let buffer_request = json!({
        "cacheSizeMb": get("playerBufferCacheMb").and_then(|v| v.parse::<i64>().ok()),
        "forwardBufferSeconds": get("playerForwardBufferSeconds").and_then(|v| v.parse::<i64>().ok()),
        "backBufferSeconds": get("playerBackBufferSeconds").and_then(|v| v.parse::<i64>().ok()),
        "isTorrent": preferences.get("isTorrentPlayback").and_then(Value::as_bool).unwrap_or(false)
    });
    if let Some(targets_json) = FluxaCore::player_buffer_targets_json(&buffer_request.to_string()) {
        if let Ok(targets) = serde_json::from_str::<Value>(&targets_json) {
            if let Some(cache_bytes) = targets.get("cacheSizeBytes").and_then(Value::as_i64) {
                options.push(("demuxer-max-bytes".to_string(), cache_bytes.to_string()));
            }
            if let Some(forward_ms) = targets.get("forwardBufferMs").and_then(Value::as_i64) {
                let seconds = (forward_ms / 1000).max(1).to_string();
                options.push(("cache-secs".to_string(), seconds.clone()));
                options.push(("demuxer-readahead-secs".to_string(), seconds));
            }
        }
    }
    if preferences
        .get("forceSoftwareAudio")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        options.push(("ad".to_string(), "lavc".to_string()));
    }
    if let Some(size) = get("subtitleSize").and_then(|v| v.parse::<f64>().ok()) {
        options.push((
            "sub-scale".to_string(),
            format!("{:.2}", (size / 100.0).clamp(0.5, 2.0)),
        ));
    }
    let sub_text_opacity = get("subtitleTextOpacity")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    if let Some(color) =
        get("subtitleColor").and_then(|v| css_hex_with_alpha_to_mpv_color(v, sub_text_opacity))
    {
        options.push(("sub-color".to_string(), color));
    }
    let sub_border_opacity = get("subtitleOutlineOpacity")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    if let Some(color) = get("subtitleOutlineColor")
        .and_then(|v| css_hex_with_alpha_to_mpv_color(v, sub_border_opacity))
    {
        options.push(("sub-border-color".to_string(), color));
    }
    let sub_bg_opacity = get("subtitleBackgroundOpacity")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.5)
        .clamp(0.0, 1.0);
    if let Some(color) = get("subtitleBackgroundColor")
        .and_then(|v| css_hex_with_alpha_to_mpv_color(v, sub_bg_opacity))
    {
        options.push(("sub-back-color".to_string(), color));
    }
    if preferences
        .get("autoEnableSubtitles")
        .and_then(|v| v.as_bool())
        == Some(false)
    {
        options.push(("sid".to_string(), "no".to_string()));
    }
    if preferences
        .get("subtitleShadow")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        options.push(("sub-shadow-offset".to_string(), "3".to_string()));
        options.push(("sub-shadow-color".to_string(), "#80000000".to_string()));
    } else {
        options.push(("sub-shadow-offset".to_string(), "0".to_string()));
    }
    let audio_languages =
        language_list(&[get("preferredAudioLanguage"), get("secondaryAudioLanguage")]);
    if !audio_languages.is_empty() {
        options.push(("alang".to_string(), audio_languages));
    }
    let subtitle_languages = language_list(&[
        get("preferredSubtitleLanguage"),
        get("secondarySubtitleLanguage"),
    ]);
    if !subtitle_languages.is_empty() {
        options.push(("slang".to_string(), subtitle_languages));
    }
    if let Some(custom) = get("mpvCustomOptions") {
        for line in custom.lines().map(str::trim) {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((name, value)) = line.split_once('=') {
                let name = name.trim();
                let value = value.trim();
                if is_safe_mpv_option_name(name) && !value.is_empty() {
                    options.push((name.to_string(), value.to_string()));
                }
            }
        }
    }
    if let Some(mode) = get("audioDecoderMode") {
        let hwdec = match mode {
            "hw_prefer" => "auto-safe",
            "hw_only" => "auto",
            "sw_only" => "no",
            _ => "",
        };
        if !hwdec.is_empty() {
            options.push(("hwdec".to_string(), hwdec.to_string()));
        }
    }
    if preferences
        .get("showFpsCounter")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        options.push(("osd-level".to_string(), "3".to_string()));
    }

    options
}

fn css_hex_with_alpha_to_mpv_color(value: &str, opacity: f64) -> Option<String> {
    let hex = value.trim().strip_prefix('#')?;
    if hex.len() == 6 && hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
        Some(format!("#{hex}{alpha:02X}"))
    } else {
        None
    }
}

fn is_safe_mpv_option_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '/')
}

fn language_list(values: &[Option<&str>]) -> String {
    values
        .iter()
        .filter_map(|v| v.map(str::trim))
        .filter(|v| !v.is_empty() && *v != "none")
        .filter(|v| v.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-'))
        .collect::<Vec<_>>()
        .join(",")
}

#[tauri::command]
pub fn player_init(app: AppHandle, state: State<DesktopState>) -> Result<(), String> {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    let _ = ensure_native_player_surface(&app, &state);

    let mut renderer = state.player_renderer.lock().unwrap();
    if renderer.is_none() {
        *renderer = Some(mpv_render::MpvRenderer::new()?);
    }
    Ok(())
}

#[tauri::command]
pub fn player_load(
    app: AppHandle,
    state: State<DesktopState>,
    url: String,
    start_at: Option<u64>,
    total_duration: Option<u64>,
) -> Result<(), String> {
    log::info!("player_load: url={url} start_at={start_at:?} total_duration={total_duration:?}");
    *state.thumb_url.lock().unwrap() = Some(url.clone());

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        if let Some(surface) = ensure_native_player_surface(&app, &state) {
            return surface.load(url, start_at, total_duration);
        }
        log::warn!("player_load: no native player surface available, falling back to headless renderer");
    }

    let _ = app;
    let mut renderer = state.player_renderer.lock().unwrap();
    if renderer.is_none() {
        *renderer = Some(mpv_render::MpvRenderer::new()?);
    }
    renderer
        .as_mut()
        .ok_or_else(|| "player renderer is not initialized".to_string())?
        .load(&url, start_at)
}

#[tauri::command]
pub fn player_apply_preferences(
    state: State<DesktopState>,
    preferences: serde_json::Value,
) -> Result<(), String> {
    let options = mpv_options_from_preferences(&preferences);
    if options.is_empty() {
        return Ok(());
    }
    state
        .player_renderer
        .lock()
        .unwrap()
        .as_ref()
        .ok_or_else(|| "player renderer is not initialized".to_string())?
        .apply_options(&options)
}

#[tauri::command]
pub fn player_set_title(state: State<DesktopState>, title: String, episode_title: Option<String>) {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    if let Some(surface) = state.native_player_surface.lock().unwrap().as_ref() {
        surface.set_title(title, episode_title);
    }
}

#[tauri::command]
pub async fn player_set_loading_artwork(
    state: State<'_, DesktopState>,
    title: String,
    episode_title: Option<String>,
    background_url: Option<String>,
    logo_url: Option<String>,
) -> Result<(), String> {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    let (background_scaled, logo_scaled) = {
        let bg_cached = background_url.as_deref()
            .and_then(|u| artwork_bg_decoded().lock().ok()?.get(&normalize_url(u)).cloned());
        let logo_cached = logo_url.as_deref()
            .and_then(|u| artwork_logo_decoded().lock().ok()?.get(&normalize_url(u)).cloned());

        let bg_ready = bg_cached.is_some() || background_url.is_none();
        let logo_ready = logo_cached.is_some() || logo_url.is_none();
        if bg_ready && logo_ready {
            (bg_cached, logo_cached)
        } else {
            let bg_fetch = if bg_cached.is_none() { background_url.clone() } else { None };
            let logo_fetch = if logo_cached.is_none() { logo_url.clone() } else { None };
            let bg_handle = tauri::async_runtime::spawn(fetch_player_artwork_bytes_owned(bg_fetch));
            let logo_handle = tauri::async_runtime::spawn(fetch_player_artwork_bytes_owned(logo_fetch));
            let background_bytes = bg_handle.await.unwrap_or(None);
            let logo_bytes = logo_handle.await.unwrap_or(None);

            let (bg_decoded, logo_decoded) = tauri::async_runtime::spawn_blocking(move || {
                let bg = background_bytes.and_then(|b| scale_artwork_cover(b, 1280, 720));
                let logo = logo_bytes.and_then(|b| scale_artwork_fit(b, 500, 170));
                (bg, logo)
            })
            .await
            .unwrap_or((None, None));
            (bg_cached.or(bg_decoded), logo_cached.or(logo_decoded))
        }
    };

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        let mut surface = state.native_player_surface.lock().unwrap().clone();
        if surface.is_none() {
            for _ in 0..6 {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                surface = state.native_player_surface.lock().unwrap().clone();
                if surface.is_some() { break; }
            }
        }
        if let Some(surface) = surface {
            surface.set_artwork(title, episode_title, background_scaled, logo_scaled);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn player_prefetch_artwork(background_url: Option<String>, logo_url: Option<String>) {
    let bg_key = background_url.as_deref().map(normalize_url);
    let logo_key = logo_url.as_deref().map(normalize_url);
    let bg = tauri::async_runtime::spawn(fetch_player_artwork_bytes_owned(background_url));
    let logo = tauri::async_runtime::spawn(fetch_player_artwork_bytes_owned(logo_url));
    let bg_bytes = bg.await.unwrap_or(None);
    let logo_bytes = logo.await.unwrap_or(None);

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    if bg_bytes.is_some() || logo_bytes.is_some() {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let (Some(key), Some(bytes)) = (bg_key, bg_bytes) {
                if let Some(decoded) = scale_artwork_cover(bytes, 1280, 720) {
                    if let Ok(mut cache) = artwork_bg_decoded().lock() {
                        cache.insert(key, decoded);
                    }
                }
            }
            if let (Some(key), Some(bytes)) = (logo_key, logo_bytes) {
                if let Some(decoded) = scale_artwork_fit(bytes, 500, 170) {
                    if let Ok(mut cache) = artwork_logo_decoded().lock() {
                        cache.insert(key, decoded);
                    }
                }
            }
        })
        .await;
    }
}

#[tauri::command]
pub fn player_add_subtitle(
    state: State<DesktopState>,
    url: String,
    title: Option<String>,
    language: Option<String>,
) -> Result<(), String> {
    state
        .player_renderer
        .lock()
        .unwrap()
        .as_ref()
        .ok_or_else(|| "player renderer is not initialized".to_string())?
        .add_subtitle(&url, title.as_deref(), language.as_deref())
}

#[tauri::command]
pub fn player_render_frame(
    state: State<DesktopState>,
    width: i32,
    height: i32,
) -> Result<mpv_render::PlayerFrame, String> {
    let mut renderer = state.player_renderer.lock().unwrap();
    renderer
        .as_mut()
        .ok_or_else(|| "player renderer is not initialized".to_string())?
        .render_frame(width, height)
}

#[tauri::command]
pub fn player_command(state: State<DesktopState>, command: String) -> Result<(), String> {
    if command == "stop" {
        *state.eof_next_fired.lock().unwrap() = true;
    }
    // User-initiated commands (pause, seek, ...) must actually take effect,
    // unlike the status poll -- block briefly instead of giving up on contention.
    let renderer = state.player_renderer.lock().unwrap();
    renderer
        .as_ref()
        .ok_or_else(|| "player renderer is not initialized".to_string())?
        .command_string(&command)
}

#[tauri::command]
pub fn player_show_loading(
    app: AppHandle,
    state: State<DesktopState>,
    title: String,
    episode_title: Option<String>,
) {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        if let Some(surface) = ensure_native_player_surface(&app, &state) {
            surface.show_loading(title, episode_title);
        }
    }
}

#[tauri::command]
pub fn player_hide(state: State<DesktopState>) {
    state.pending_hide.store(true, Ordering::Release);
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    if let Some(surface) = state.native_player_surface.lock().unwrap().as_ref() {
        surface.hide();
    }

    let _ = state;
}

#[tauri::command]
pub fn player_title(state: State<DesktopState>) -> Option<String> {
    state
        .player_renderer
        .lock()
        .unwrap()
        .as_ref()
        .and_then(mpv_render::MpvRenderer::title)
}

#[tauri::command]
pub fn player_status(state: State<DesktopState>) -> Result<mpv_render::PlayerStatus, String> {
    state
        .player_renderer
        .try_lock()
        .map_err(|_| "player renderer busy".to_string())?
        .as_ref()
        .ok_or_else(|| "player renderer is not initialized".to_string())
        .map(mpv_render::MpvRenderer::status)
}

#[tauri::command]
pub fn player_get_playback_info(state: State<DesktopState>) -> serde_json::Value {
    serde_json::json!({
        "skipSegmentsJson": state.skip_segments_json.lock().unwrap().clone(),
        "chaptersJson": state.chapters_json.lock().unwrap().clone(),
        "episodesJson": state.episodes_json.lock().unwrap().clone(),
        "nextEpSubtitle": state.next_ep_subtitle.lock().unwrap().clone(),
        "nextEpThresholdPercent": *state.next_ep_threshold_percent.lock().unwrap(),
        "autoPlayNextEpisode": *state.auto_play_next_episode.lock().unwrap(),
        "autoPlayCountdownSecs": *state.auto_play_countdown_secs.lock().unwrap(),
    })
}

#[tauri::command]
pub fn player_track_options(state: State<DesktopState>, track_type: String) -> Vec<mpv_render::PlayerTrackOption> {
    state
        .player_renderer
        .try_lock()
        .ok()
        .and_then(|g| g.as_ref().map(|r| r.track_options(&track_type)))
        .unwrap_or_default()
}

#[tauri::command]
pub fn player_destroy(state: State<DesktopState>) -> bool {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    if let Some(surface) = state.native_player_surface.lock().unwrap().as_ref() {
        surface.hide();
        return state.player_renderer.lock().unwrap().is_some();
    }

    state.player_renderer.lock().unwrap().take().is_some()
}

#[tauri::command]
pub fn player_set_chapters(state: State<DesktopState>, chapters_json: String) {
    *state.chapters_json.lock().unwrap() =
        if chapters_json.trim().is_empty() || chapters_json == "[]" {
            None
        } else {
            Some(chapters_json)
        };
}

#[tauri::command]
pub fn player_clear_chapters(state: State<DesktopState>) {
    *state.chapters_json.lock().unwrap() = None;
}

#[tauri::command]
pub fn player_set_skip_info(
    state: State<DesktopState>,
    segments_json: String,
    next_ep_subtitle: Option<String>,
    next_ep_threshold_percent: Option<f64>,
    auto_play_next_episode: Option<bool>,
    auto_play_countdown_secs: Option<u32>,
) {
    *state.skip_segments_json.lock().unwrap() =
        if segments_json.trim().is_empty() || segments_json == "[]" {
            None
        } else {
            Some(segments_json)
        };
    *state.next_ep_subtitle.lock().unwrap() = next_ep_subtitle.unwrap_or_default();
    *state.eof_next_fired.lock().unwrap() = false;
    if let Some(t) = next_ep_threshold_percent {
        *state.next_ep_threshold_percent.lock().unwrap() = t.clamp(1.0, 99.0);
    }
    if let Some(v) = auto_play_next_episode {
        *state.auto_play_next_episode.lock().unwrap() = v;
    }
    if let Some(s) = auto_play_countdown_secs {
        *state.auto_play_countdown_secs.lock().unwrap() = s.max(1);
    }
}

#[tauri::command]
pub fn player_clear_skip_info(state: State<DesktopState>) {
    *state.skip_segments_json.lock().unwrap() = None;
    *state.next_ep_subtitle.lock().unwrap() = String::new();
    *state.eof_next_fired.lock().unwrap() = false;
}

#[tauri::command]
pub fn player_set_episodes(state: State<DesktopState>, episodes_json: String) {
    *state.episodes_json.lock().unwrap() =
        if episodes_json.trim() == "[]" || episodes_json.trim().is_empty() {
            None
        } else {
            Some(episodes_json)
        };
}

#[tauri::command]
pub fn player_clear_episodes(state: State<DesktopState>) {
    *state.episodes_json.lock().unwrap() = None;
}

#[tauri::command]
pub fn player_set_seek_thumbnail_enabled(state: State<DesktopState>, enabled: bool) {
    *state.seek_thumbnail_enabled.lock().unwrap() = enabled;
}

#[tauri::command]
pub fn player_get_seek_thumbnail(state: State<DesktopState>, time_pos: f64) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    if !*state.seek_thumbnail_enabled.lock().unwrap() {
        return Ok(String::new());
    }
    let url = state.thumb_url.lock().unwrap().clone().ok_or_else(|| "no url".to_string())?;

    let mut renderer_guard = state.thumbnail_renderer.lock().unwrap();
    let mut loaded_url_guard = state.thumbnail_loaded_url.lock().unwrap();

    if renderer_guard.is_none() {
        *renderer_guard = Some(mpv_render::MpvRenderer::new_thumbnail()?);
    }
    let renderer = renderer_guard.as_mut().unwrap();

    if loaded_url_guard.as_deref() != Some(url.as_str()) {
        renderer.load_thumbnail(&url)?;
        *loaded_url_guard = Some(url.clone());
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    renderer.seek_to(time_pos)?;
    std::thread::sleep(std::time::Duration::from_millis(200));

    let pixels = renderer.render_thumbnail(320, 180)?;
    drop(renderer_guard);
    drop(loaded_url_guard);

    let img = image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(320, 180, pixels)
        .ok_or_else(|| "frame buffer mismatch".to_string())?;
    let rgb = image::DynamicImage::ImageRgba8(img).to_rgb8();
    let mut jpeg: Vec<u8> = Vec::new();
    rgb.write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    Ok(format!("data:image/jpeg;base64,{}", general_purpose::STANDARD.encode(&jpeg)))
}
