use crate::artwork::{
    artwork_bg_decoded, artwork_logo_decoded, fetch_player_artwork_bytes_owned, normalize_url,
    scale_artwork_cover, scale_artwork_fit,
};
use crate::custom_fonts;
use crate::libvlc_render;
use crate::mpv_render;
use crate::playback_engine::{self, PlaybackEngine, PlayerEngine};
use crate::DesktopState;
use fluxa_core::FluxaCore;
use serde_json::{json, Value};
use std::process::Command;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "linux")]
use crate::linux_player_surface;
#[cfg(target_os = "macos")]
use crate::macos_player_surface;
#[cfg(target_os = "windows")]
use crate::windows_player_surface;

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

fn mpv_options_from_preferences(
    app: Option<&AppHandle>,
    preferences: &serde_json::Value,
) -> (Vec<(String, String)>, bool) {
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
            if let Some(back_ms) = targets.get("backBufferMs").and_then(Value::as_i64) {
                let cache_bytes = targets
                    .get("cacheSizeBytes")
                    .and_then(Value::as_i64)
                    .unwrap_or(100_000_000);
                let back_bytes = ((back_ms / 1000) * 1_310_720).clamp(10_000_000, cache_bytes);
                options.push(("demuxer-max-back-bytes".to_string(), back_bytes.to_string()));
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
    if let Some(position) = get("subtitlePosition").and_then(|v| v.parse::<f64>().ok()) {
        options.push((
            "sub-pos".to_string(),
            format!("{:.0}", position.clamp(0.0, 100.0)),
        ));
    }
    if let Some(font) = get("subtitleFont") {
        if !font.is_empty() && font != "default" {
            options.push(("sub-font".to_string(), font.to_string()));
        }
    }
    if let Some(app) = app {
        let state = app.state::<DesktopState>();
        if let Ok(dir) = custom_fonts::fonts_dir(&state) {
            options.push((
                "sub-fonts-dir".to_string(),
                dir.to_string_lossy().into_owned(),
            ));
        }
    }
    let anime4k_applied = push_anime_upscaling_options(
        &mut options,
        app,
        get("animeUpscalingMode"),
        get("animeUpscalingQuality"),
        get("animeUpscalingModePreset"),
        preferences
            .get("isAnimePlayback")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    );
    push_frame_interpolation_options(&mut options, get("frameInterpolationMode"));
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
    let subtitle_outline_size = get("subtitleOutlineSize")
        .and_then(|v| v.parse::<f64>().ok())
        .map(|size| size.clamp(0.0, 6.0));
    if let Some(size) = subtitle_outline_size {
        options.push((
            "sub-border-size".to_string(),
            format!("{:.1}", size.clamp(0.0, 6.0)),
        ));
    }
    if preferences
        .get("subtitleBold")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        options.push(("sub-bold".to_string(), "yes".to_string()));
    }
    if preferences
        .get("subtitleForceStyle")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        options.push(("sub-ass-override".to_string(), "force".to_string()));
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
    let anime_japanese = preferences
        .get("isAnimePlayback")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && preferences
            .get("animePreferJapaneseAudio")
            .and_then(Value::as_bool)
            .unwrap_or(false);
    if !anime_japanese
        && preferences
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
    match get("subtitleCharacterEdge") {
        Some("none") => {
            options.push(("sub-border-size".to_string(), "0".to_string()));
            options.push(("sub-shadow-offset".to_string(), "0".to_string()));
        }
        Some("raised") => {
            options.push(("sub-border-size".to_string(), "1.5".to_string()));
            options.push(("sub-shadow-offset".to_string(), "-1".to_string()));
        }
        Some("depressed") => {
            options.push(("sub-border-size".to_string(), "1.5".to_string()));
            options.push(("sub-shadow-offset".to_string(), "1".to_string()));
        }
        Some("uniform") => {
            options.push((
                "sub-border-size".to_string(),
                format!("{:.1}", subtitle_outline_size.unwrap_or(3.0)),
            ));
            options.push(("sub-shadow-offset".to_string(), "0".to_string()));
        }
        Some("drop-shadow") => {
            options.push(("sub-border-size".to_string(), "0".to_string()));
            options.push(("sub-shadow-offset".to_string(), "3".to_string()));
            options.push(("sub-shadow-color".to_string(), "#80000000".to_string()));
        }
        _ => {}
    }
    let audio_languages = if anime_japanese {
        language_list(&[
            Some("ja"),
            Some("jpn"),
            get("preferredAudioLanguage"),
            get("secondaryAudioLanguage"),
        ])
    } else {
        language_list(&[get("preferredAudioLanguage"), get("secondaryAudioLanguage")])
    };
    if !audio_languages.is_empty() {
        options.push(("alang".to_string(), audio_languages));
    }
    let mut subtitle_languages = language_list(&[
        get("preferredSubtitleLanguage"),
        get("secondarySubtitleLanguage"),
    ]);
    if anime_japanese && subtitle_languages.is_empty() {
        subtitle_languages = "eng,en".to_string();
    }
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
    (options, anime4k_applied)
}

fn push_anime_upscaling_options(
    options: &mut Vec<(String, String)>,
    app: Option<&AppHandle>,
    mode: Option<&str>,
    quality: Option<&str>,
    mode_preset: Option<&str>,
    is_anime_playback: bool,
) -> bool {
    options.push(("glsl-shaders".to_string(), String::new()));

    let quality = match mode.unwrap_or("off") {
        "auto" if is_anime_playback => quality.unwrap_or("anime4k_m"),
        "anime4k_s" | "anime4k_m" | "anime4k_l" if is_anime_playback => mode.unwrap_or("off"),
        _ => return false,
    };
    let mode_preset = mode_preset.unwrap_or("a");
    let Some(chain_path) = resolve_anime4k_chain(app, quality, mode_preset) else {
        log::warn!("Anime4K shader chain for '{quality}'/'{mode_preset}' was not found");
        return false;
    };

    options.push(("scale".to_string(), "ewa_lanczossharp".to_string()));
    options.push(("cscale".to_string(), "ewa_lanczos".to_string()));
    options.push(("dscale".to_string(), "mitchell".to_string()));
    options.push(("correct-downscaling".to_string(), "yes".to_string()));
    options.push(("linear-downscaling".to_string(), "yes".to_string()));
    options.push(("glsl-shaders".to_string(), chain_path));
    true
}

fn anime4k_thin_shader(tier: &str) -> &'static str {
    match tier {
        "anime4k_s" => "Anime4K_Thin_VeryFast.glsl",
        "anime4k_l" => "Anime4K_Thin_HQ.glsl",
        _ => "Anime4K_Thin_Fast.glsl",
    }
}

fn anime4k_chain_shaders(tier: &str, mode: &str) -> Vec<String> {
    let mut chain = vec!["Anime4K_Clamp_Highlights.glsl".to_string()];

    if tier == "anime4k_s" {
        match mode {
            "b" => {
                chain.push("Anime4K_Restore_CNN_Soft_S.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
            }
            "bb" => {
                chain.push("Anime4K_Restore_CNN_Soft_S.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push("Anime4K_Restore_CNN_Soft_S.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
            }
            "c" => {
                chain.push("Anime4K_Upscale_Denoise_CNN_x2_S.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
            }
            "ca" => {
                chain.push("Anime4K_Upscale_Denoise_CNN_x2_S.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push("Anime4K_Restore_CNN_S.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
            }
            "aa" => {
                chain.push("Anime4K_Restore_CNN_S.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
                chain.push("Anime4K_Restore_CNN_S.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
            }
            _ => {
                chain.push("Anime4K_Restore_CNN_S.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push("Anime4K_Upscale_CNN_x2_S.glsl".to_string());
            }
        }
    } else {
        let (primary, secondary) = if tier == "anime4k_l" {
            ("VL", "M")
        } else {
            ("M", "S")
        };
        match mode {
            "b" => {
                chain.push(format!("Anime4K_Restore_CNN_Soft_{primary}.glsl"));
                chain.push(format!("Anime4K_Upscale_CNN_x2_{primary}.glsl"));
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push(format!("Anime4K_Upscale_CNN_x2_{secondary}.glsl"));
            }
            "bb" => {
                chain.push(format!("Anime4K_Restore_CNN_Soft_{primary}.glsl"));
                chain.push(format!("Anime4K_Upscale_CNN_x2_{primary}.glsl"));
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push(format!("Anime4K_Restore_CNN_Soft_{secondary}.glsl"));
                chain.push(format!("Anime4K_Upscale_CNN_x2_{secondary}.glsl"));
            }
            "c" => {
                chain.push(format!("Anime4K_Upscale_Denoise_CNN_x2_{primary}.glsl"));
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push(format!("Anime4K_Upscale_CNN_x2_{secondary}.glsl"));
            }
            "ca" => {
                chain.push(format!("Anime4K_Upscale_Denoise_CNN_x2_{primary}.glsl"));
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push(format!("Anime4K_Restore_CNN_{secondary}.glsl"));
                chain.push(format!("Anime4K_Upscale_CNN_x2_{secondary}.glsl"));
            }
            "aa" => {
                chain.push(format!("Anime4K_Restore_CNN_{primary}.glsl"));
                chain.push(format!("Anime4K_Upscale_CNN_x2_{primary}.glsl"));
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push(format!("Anime4K_Restore_CNN_{secondary}.glsl"));
                chain.push(format!("Anime4K_Upscale_CNN_x2_{secondary}.glsl"));
            }
            _ => {
                chain.push(format!("Anime4K_Restore_CNN_{primary}.glsl"));
                chain.push(format!("Anime4K_Upscale_CNN_x2_{primary}.glsl"));
                chain.push("Anime4K_AutoDownscalePre_x2.glsl".to_string());
                chain.push("Anime4K_AutoDownscalePre_x4.glsl".to_string());
                chain.push(format!("Anime4K_Upscale_CNN_x2_{secondary}.glsl"));
            }
        }
    }

    chain.push(anime4k_thin_shader(tier).to_string());
    chain
}

fn resolve_anime4k_chain(app: Option<&AppHandle>, tier: &str, mode: &str) -> Option<String> {
    let shader_names = anime4k_chain_shaders(tier, mode);
    let mut paths = Vec::with_capacity(shader_names.len());
    for shader_name in &shader_names {
        let path = resolve_shader_path(app, shader_name)?;
        paths.push(path.replace('\\', "/"));
    }
    let separator = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    Some(paths.join(separator))
}

fn anime4k_should_apply(preferences: &Value) -> bool {
    let is_anime_playback = preferences
        .get("isAnimePlayback")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    matches!(
        preferences
            .get("animeUpscalingMode")
            .and_then(Value::as_str),
        Some("auto" | "anime4k_s" | "anime4k_m" | "anime4k_l")
    ) && is_anime_playback
}

fn resolve_shader_path(app: Option<&AppHandle>, shader_name: &str) -> Option<String> {
    let resource_path = format!("assets/mpv-shaders/anime4k/{shader_name}");
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(&resource_path);
    if cfg!(debug_assertions) && dev_path.exists() {
        return Some(dev_path.to_string_lossy().into_owned());
    }
    if let Some(app) = app {
        if let Ok(path) = app.path().resolve(&resource_path, BaseDirectory::Resource) {
            if path.exists() {
                return Some(path.to_string_lossy().into_owned());
            }
        }
    }

    if dev_path.exists() {
        return Some(dev_path.to_string_lossy().into_owned());
    }
    None
}

fn push_frame_interpolation_options(options: &mut Vec<(String, String)>, mode: Option<&str>) {
    match mode.unwrap_or("off") {
        "display_resample" => {
            options.push(("video-sync".to_string(), "display-resample".to_string()));
            options.push(("interpolation".to_string(), "yes".to_string()));
            options.push(("tscale".to_string(), "oversample".to_string()));
        }
        "smooth" => {
            options.push(("video-sync".to_string(), "display-resample".to_string()));
            options.push(("interpolation".to_string(), "yes".to_string()));
            options.push(("tscale".to_string(), "mitchell".to_string()));
            options.push(("tscale-clamp".to_string(), "0.0".to_string()));
        }
        _ => {
            options.push(("video-sync".to_string(), "audio".to_string()));
            options.push(("interpolation".to_string(), "no".to_string()));
        }
    }
}

fn css_hex_with_alpha_to_mpv_color(value: &str, opacity: f64) -> Option<String> {
    let hex = value.trim().strip_prefix('#')?;
    if hex.len() == 6 && hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
        let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
        Some(format!("#{alpha:02X}{hex}"))
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

fn with_renderer_retry<T, F>(
    state: &DesktopState,
    attempts: usize,
    f: F,
) -> Result<Option<T>, String>
where
    F: Fn(&dyn PlaybackEngine) -> Result<T, String>,
{
    let engine = *state.active_player_engine.lock().unwrap();
    for _ in 0..attempts {
        match engine {
            PlayerEngine::Mpv => {
                if let Ok(guard) = state.player_renderer.try_lock() {
                    if let Some(renderer) = guard.as_ref() {
                        return f(renderer).map(Some);
                    }
                    return Ok(None);
                }
            }
            PlayerEngine::Vlc => {
                if let Ok(guard) = state.player_renderer_vlc.try_lock() {
                    if let Some(renderer) = guard.as_ref() {
                        return f(renderer).map(Some);
                    }
                    return Ok(None);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    Err("player renderer busy".to_string())
}

#[tauri::command]
pub async fn player_init(app: AppHandle, state: State<'_, DesktopState>) -> Result<(), String> {
    log::info!("player_init: start");
    state.pending_hide.store(false, Ordering::Release);

    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    {
        let app_clone = app.clone();
        let native_ready = tauri::async_runtime::spawn_blocking(move || {
            let state = app_clone.state::<DesktopState>();
            ensure_native_player_surface(&app_clone, &state).is_some()
        })
        .await
        .map_err(|e| e.to_string())?;
        if native_ready {
            log::info!("player_init: native surface ready");
        } else {
            log::warn!(
                "player_init: native player surface unavailable, using software video rendering"
            );
        }
    }

    let app_for_headless = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_headless.state::<DesktopState>();
        let mut renderer = state.player_renderer.lock().unwrap();
        if renderer.is_none() {
            match mpv_render::MpvRenderer::new() {
                Ok(r) => *renderer = Some(r),
                Err(error) => {
                    log::error!("player_init: MpvRenderer::new failed: {error}");
                    sentry::capture_message(
                        &format!("MpvRenderer::new failed: {error}"),
                        sentry::Level::Error,
                    );
                    return Err(error);
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    log::info!("player_init: ok");
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

    let engine = playback_engine::read_player_engine(&app);
    *state.active_player_engine.lock().unwrap() = engine;
    if engine == PlayerEngine::Vlc {
        let mut renderer = state.player_renderer_vlc.lock().unwrap();
        if renderer.is_none() {
            *renderer = Some(libvlc_render::LibvlcPlayer::new()?);
        }
        return renderer
            .as_mut()
            .ok_or_else(|| "libvlc player is not initialized".to_string())?
            .load(&url, start_at);
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(surface) = ensure_native_player_surface(&app, &state) {
            match surface.load(url.clone(), start_at, total_duration) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    log::warn!("player_load: Windows native player surface failed, using software video rendering: {error}");
                    *state.native_player_surface.lock().unwrap() = None;
                }
            }
        }
        log::warn!(
            "player_load: Windows native player surface unavailable, using software video rendering"
        );
        if let Ok(mut renderer) = state.player_renderer.lock() {
            if let Some(renderer) = renderer.as_mut() {
                renderer.reset_render_context();
            }
        }
        let _ = app.emit("native-player-show", ());
        let _ = app.emit(
            "native-player-software-rendering",
            "Windows native player surface is unavailable; using software video rendering",
        );
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        if let Some(surface) = ensure_native_player_surface(&app, &state) {
            return surface.load(url, start_at, total_duration);
        }
        log::warn!(
            "player_load: no native player surface available, falling back to headless renderer"
        );
    }

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
pub fn player_set_http_headers(
    state: State<DesktopState>,
    headers: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let header_list = headers.into_iter().collect::<Vec<_>>();
    match with_renderer_retry(&state, 80, |renderer| {
        renderer.set_http_headers(&header_list)
    }) {
        Ok(Some(())) => Ok(()),
        Ok(None) | Err(_) => Ok(()),
    }
}

#[tauri::command]
pub fn player_apply_preferences(
    app: AppHandle,
    state: State<DesktopState>,
    preferences: serde_json::Value,
) -> Result<(), String> {
    if let Some(v) = preferences.get("useChapterSkip").and_then(|v| v.as_bool()) {
        *state.use_chapter_skip.lock().unwrap() = v;
    }
    let (options, anime4k_resolved) = mpv_options_from_preferences(Some(&app), &preferences);
    if anime4k_should_apply(&preferences) && !anime4k_resolved {
        log::warn!("Anime4K was requested by preferences but its shader could not be resolved");
    }
    let options_applied = if options.is_empty() {
        true
    } else {
        match with_renderer_retry(&state, 80, |renderer| renderer.apply_options(&options)) {
            Ok(Some(())) => true,
            Ok(None) => {
                log::warn!("Preferences could not be applied: player renderer not ready");
                false
            }
            Err(err) => {
                log::warn!("Preferences could not be applied: {err}");
                false
            }
        }
    };
    let anime4k_enabled = anime4k_resolved && options_applied;
    *state.anime4k_enabled.lock().unwrap() = anime4k_enabled;
    let _ = app.emit(
        "player-anime4k-state",
        serde_json::json!({ "enabled": anime4k_enabled }),
    );
    Ok(())
}

#[tauri::command]
pub fn player_set_cursor_visible(state: State<DesktopState>, visible: bool) {
    #[cfg(target_os = "windows")]
    if let Some(surface) = state.native_player_surface.lock().unwrap().as_ref() {
        surface.set_cursor_visible(visible);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (state, visible);
}

#[tauri::command]
pub fn player_set_title(
    app: AppHandle,
    state: State<DesktopState>,
    title: String,
    episode_title: Option<String>,
) {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    if let Some(surface) = state.native_player_surface.lock().unwrap().as_ref() {
        surface.set_title(title.clone(), episode_title.clone());
    }
    let _ = app.emit(
        "native-player-title",
        serde_json::json!({ "title": title, "episodeTitle": episode_title }),
    );
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
        let bg_cached = background_url.as_deref().and_then(|u| {
            artwork_bg_decoded()
                .lock()
                .ok()?
                .get(&normalize_url(u))
                .cloned()
        });
        let logo_cached = logo_url.as_deref().and_then(|u| {
            artwork_logo_decoded()
                .lock()
                .ok()?
                .get(&normalize_url(u))
                .cloned()
        });

        let bg_ready = bg_cached.is_some() || background_url.is_none();
        let logo_ready = logo_cached.is_some() || logo_url.is_none();
        if bg_ready && logo_ready {
            (bg_cached, logo_cached)
        } else {
            let bg_fetch = if bg_cached.is_none() {
                background_url.clone()
            } else {
                None
            };
            let logo_fetch = if logo_cached.is_none() {
                logo_url.clone()
            } else {
                None
            };
            let bg_handle = tauri::async_runtime::spawn(fetch_player_artwork_bytes_owned(bg_fetch));
            let logo_handle =
                tauri::async_runtime::spawn(fetch_player_artwork_bytes_owned(logo_fetch));
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
                if surface.is_some() {
                    break;
                }
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
    match with_renderer_retry(&state, 80, |renderer| {
        renderer.add_subtitle(&url, title.as_deref(), language.as_deref())
    }) {
        Ok(Some(())) => Ok(()),
        Ok(None) => Err("player renderer is not initialized".to_string()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn player_render_frame(
    state: State<DesktopState>,
    width: i32,
    height: i32,
) -> Result<mpv_render::PlayerFrame, String> {
    if *state.active_player_engine.lock().unwrap() == PlayerEngine::Vlc {
        return Err("headless frame rendering is not supported by the libvlc engine".to_string());
    }
    let mut renderer = state.player_renderer.lock().unwrap();
    renderer
        .as_mut()
        .ok_or_else(|| "player renderer is not initialized".to_string())?
        .render_frame(width, height)
}

#[tauri::command]
pub fn player_set_anime4k_enabled(
    app: AppHandle,
    state: State<DesktopState>,
    enabled: bool,
    quality: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    let commands: Vec<Vec<String>> = if enabled {
        let chain_path = resolve_anime4k_chain(
            Some(&app),
            quality.as_deref().unwrap_or("anime4k_m"),
            mode.as_deref().unwrap_or("a"),
        )
        .ok_or_else(|| "Anime4K shader chain not found".to_string())?;
        vec![
            vec![
                "change-list".to_string(),
                "glsl-shaders".to_string(),
                "set".to_string(),
                chain_path,
            ],
            vec![
                "set".to_string(),
                "scale".to_string(),
                "ewa_lanczossharp".to_string(),
            ],
            vec![
                "set".to_string(),
                "cscale".to_string(),
                "ewa_lanczos".to_string(),
            ],
            vec![
                "set".to_string(),
                "dscale".to_string(),
                "mitchell".to_string(),
            ],
            vec![
                "set".to_string(),
                "correct-downscaling".to_string(),
                "yes".to_string(),
            ],
            vec![
                "set".to_string(),
                "linear-downscaling".to_string(),
                "yes".to_string(),
            ],
        ]
    } else {
        vec![
            vec![
                "change-list".to_string(),
                "glsl-shaders".to_string(),
                "clr".to_string(),
                String::new(),
            ],
            vec![
                "set".to_string(),
                "scale".to_string(),
                "bilinear".to_string(),
            ],
            vec![
                "set".to_string(),
                "cscale".to_string(),
                "bilinear".to_string(),
            ],
            vec![
                "set".to_string(),
                "dscale".to_string(),
                "mitchell".to_string(),
            ],
        ]
    };
    for command in commands {
        let args = command.iter().map(String::as_str).collect::<Vec<_>>();
        with_renderer_retry(&state, 60, |renderer| renderer.command_args(&args))?;
    }
    *state.anime4k_enabled.lock().unwrap() = enabled;
    let _ = app.emit(
        "player-anime4k-state",
        serde_json::json!({ "enabled": enabled }),
    );
    Ok(())
}

#[tauri::command]
pub fn player_get_anime4k_enabled(state: State<DesktopState>) -> bool {
    *state.anime4k_enabled.lock().unwrap()
}

#[tauri::command]
pub fn player_command(state: State<DesktopState>, command: String) -> Result<(), String> {
    if command == "stop" {
        *state.eof_next_fired.lock().unwrap() = true;
    }
    match with_renderer_retry(&state, 60, |renderer| renderer.command_string(&command)) {
        Ok(Some(())) => Ok(()),
        Ok(None) => Err("player renderer is not initialized".to_string()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn player_set_sleep_inhibition(
    state: State<DesktopState>,
    enabled: bool,
) -> Result<(), String> {
    state.sleep_inhibitor.lock().unwrap().set_enabled(enabled)
}

fn selected_external_subtitle_source(renderer: &dyn PlaybackEngine) -> Option<String> {
    let count = renderer
        .query_property("track-list/count")?
        .parse::<usize>()
        .ok()?;
    for index in 0..count {
        if renderer
            .query_property(&format!("track-list/{index}/type"))
            .as_deref()
            != Some("sub")
            || renderer
                .query_property(&format!("track-list/{index}/selected"))
                .as_deref()
                != Some("yes")
        {
            continue;
        }
        if let Some(source) =
            renderer.query_property(&format!("track-list/{index}/external-filename"))
        {
            if !source.trim().is_empty() {
                return Some(source);
            }
        }
    }
    None
}

async fn load_subtitle_text(source: &str) -> Result<String, String> {
    if source.starts_with("http://") || source.starts_with("https://") {
        return reqwest::get(source)
            .await
            .map_err(|error| error.to_string())?
            .text()
            .await
            .map_err(|error| error.to_string());
    }
    let path = source.strip_prefix("file://").unwrap_or(source);
    std::fs::read_to_string(path).map_err(|error| error.to_string())
}

fn speech_intervals_from_media(source: &str, analysis_seconds: f64) -> Result<Vec<Value>, String> {
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-nostats",
            "-t",
            &analysis_seconds.to_string(),
            "-i",
            source,
            "-map",
            "0:a:0",
            "-af",
            "silencedetect=n=-35dB:d=0.2",
            "-f",
            "null",
            "-",
        ])
        .output()
        .map_err(|error| format!("could not run ffmpeg: {error}"))?;
    let log = String::from_utf8_lossy(&output.stderr);
    let mut speech_start = 0.0;
    let mut intervals = Vec::new();
    for line in log.lines() {
        if let Some(value) = line
            .split("silence_start:")
            .nth(1)
            .and_then(|value| value.trim().parse::<f64>().ok())
        {
            if value - speech_start >= 0.2 {
                intervals.push(json!({ "start": speech_start, "end": value }));
            }
        }
        if let Some(value) = line
            .split("silence_end:")
            .nth(1)
            .and_then(|value| value.trim().split_whitespace().next()?.parse::<f64>().ok())
        {
            speech_start = value;
        }
    }
    if analysis_seconds - speech_start >= 0.2 {
        intervals.push(json!({ "start": speech_start, "end": analysis_seconds }));
    }
    if intervals.is_empty() {
        return Err("no speech activity could be detected".to_string());
    }
    Ok(intervals)
}

#[tauri::command]
pub async fn player_auto_sync_subtitles(state: State<'_, DesktopState>) -> Result<Value, String> {
    let (media_source, subtitle_source, duration) = with_renderer_retry(&state, 60, |renderer| {
        Ok((
            renderer.query_property("path"),
            selected_external_subtitle_source(renderer),
            renderer.query_property("duration"),
        ))
    })?
    .ok_or_else(|| "player renderer is not initialized".to_string())?;
    let media_source = media_source.ok_or_else(|| "media source is unavailable".to_string())?;
    let subtitle_source = subtitle_source
        .ok_or_else(|| "automatic sync requires an external subtitle track".to_string())?;
    let subtitle_text = load_subtitle_text(&subtitle_source).await?;
    let analysis_seconds = duration
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| *value > 0.0)
        .unwrap_or(600.0)
        .min(600.0);
    let speech_intervals = tauri::async_runtime::spawn_blocking(move || {
        speech_intervals_from_media(&media_source, analysis_seconds)
    })
    .await
    .map_err(|error| error.to_string())??;
    let request = json!({ "subtitleText": subtitle_text, "speechIntervals": speech_intervals });
    FluxaCore::subtitle_sync_estimate_json(&request.to_string())
        .and_then(|result| serde_json::from_str(&result).ok())
        .ok_or_else(|| "could not determine a reliable subtitle delay".to_string())
}

#[tauri::command]
pub async fn player_capture_subtitle_cues(state: State<'_, DesktopState>) -> Result<Value, String> {
    let (subtitle_source, current_time) = with_renderer_retry(&state, 60, |renderer| {
        Ok((
            selected_external_subtitle_source(renderer),
            renderer.query_property("time-pos"),
        ))
    })?
    .ok_or_else(|| "player renderer is not initialized".to_string())?;
    let subtitle_source =
        subtitle_source.ok_or_else(|| "capture requires an external subtitle track".to_string())?;
    let current_time = current_time
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value >= 0.0)
        .ok_or_else(|| "playback time is unavailable".to_string())?;
    let subtitle_text = load_subtitle_text(&subtitle_source).await?;
    let request = json!({ "subtitleText": subtitle_text, "currentTime": current_time });
    FluxaCore::subtitle_cues_around_time_json(&request.to_string())
        .and_then(|result| serde_json::from_str(&result).ok())
        .map(|mut result: Value| {
            result["capturedTime"] = json!(current_time);
            result
        })
        .ok_or_else(|| "could not read subtitle cues".to_string())
}

#[tauri::command]
pub fn player_screenshot(
    state: State<DesktopState>,
    suggested_name: String,
) -> Result<String, String> {
    let base_dir = state
        .download_dir
        .lock()
        .unwrap()
        .clone()
        .or_else(|| state.data_dir.lock().unwrap().clone())
        .ok_or_else(|| "no writable directory available".to_string())?;
    let screenshots_dir = base_dir.join("Screenshots");
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| e.to_string())?;

    let safe_name: String = suggested_name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = screenshots_dir.join(format!("{safe_name}_{timestamp}.png"));
    let path_str = path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");

    match with_renderer_retry(&state, 60, |renderer| {
        renderer.command_string(&format!("screenshot-to-file \"{path_str}\" video"))
    }) {
        Ok(Some(())) => Ok(path.to_string_lossy().to_string()),
        Ok(None) => Err("player renderer is not initialized".to_string()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn player_show_loading(
    app: AppHandle,
    state: State<DesktopState>,
    title: String,
    episode_title: Option<String>,
) {
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    if let Some(surface) = state.native_player_surface.lock().unwrap().as_ref() {
        surface.show_loading(title, episode_title);
        return;
    }
    let _ = app.emit(
        "native-player-title",
        serde_json::json!({ "title": title, "episodeTitle": episode_title }),
    );
}

#[tauri::command]
pub fn player_hide(app: AppHandle, state: State<DesktopState>) {
    state.pending_hide.store(true, Ordering::Release);
    let _ = state.sleep_inhibitor.lock().unwrap().set_enabled(false);
    #[cfg(any(target_os = "linux", target_os = "windows", target_os = "macos"))]
    if let Some(surface) = state.native_player_surface.lock().unwrap().as_ref() {
        surface.hide();
        return;
    }

    let _ = app.emit("native-player-hide", ());
}

#[tauri::command]
pub fn player_title(state: State<DesktopState>) -> Option<String> {
    with_renderer_retry(&state, 20, |renderer| Ok(renderer.title()))
        .ok()
        .flatten()
        .flatten()
}

#[tauri::command]
pub fn player_status(
    app: AppHandle,
    state: State<DesktopState>,
) -> Result<mpv_render::PlayerStatus, String> {
    if let Ok(mut guard) = state.player_renderer_vlc.try_lock() {
        if let Some(renderer) = guard.as_mut() {
            for event in renderer.poll_events() {
                let mpv_render::PlayerEvent::EndFile { eof, error } = event;
                if let Some(message) = error {
                    let _ = app.emit("native-player-error", message);
                } else if eof {
                    let next_sub = state.next_ep_subtitle.lock().unwrap().clone();
                    let auto_play = *state.auto_play_next_episode.lock().unwrap();
                    if FluxaCore::should_play_next_episode(!next_sub.is_empty(), auto_play) {
                        let _ = app.emit("native-player-next-episode", ());
                    } else {
                        let _ = app.emit("native-player-close-requested", ());
                    }
                }
            }
        }
    }
    match with_renderer_retry(&state, 80, |renderer| Ok(renderer.status())) {
        Ok(Some(status)) => Ok(status),
        Ok(None) => Err("player renderer is not initialized".to_string()),
        Err(e) => Err(e),
    }
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
        "autoSkipSegments": *state.auto_skip_segments.lock().unwrap(),
    })
}

#[tauri::command]
pub fn player_track_options(
    state: State<DesktopState>,
    track_type: String,
) -> Vec<mpv_render::PlayerTrackOption> {
    with_renderer_retry(&state, 80, |renderer| {
        Ok(renderer.track_options(&track_type))
    })
    .ok()
    .flatten()
    .unwrap_or_default()
}

#[tauri::command]
pub fn player_destroy(state: State<DesktopState>) -> bool {
    let _ = state.sleep_inhibitor.lock().unwrap().set_enabled(false);
    if *state.active_player_engine.lock().unwrap() == PlayerEngine::Vlc {
        return state.player_renderer_vlc.lock().unwrap().take().is_some();
    }
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
    app: AppHandle,
    state: State<DesktopState>,
    segments_json: String,
    next_ep_subtitle: Option<String>,
    next_ep_threshold_percent: Option<f64>,
    auto_play_next_episode: Option<bool>,
    auto_play_countdown_secs: Option<u32>,
    auto_skip_segments: Option<bool>,
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
    if let Some(v) = auto_skip_segments {
        *state.auto_skip_segments.lock().unwrap() = v;
    }
    let _ = app.emit("player-skip-info-updated", ());
}

#[tauri::command]
pub fn player_clear_skip_info(app: AppHandle, state: State<DesktopState>) {
    *state.skip_segments_json.lock().unwrap() = None;
    *state.next_ep_subtitle.lock().unwrap() = String::new();
    *state.eof_next_fired.lock().unwrap() = false;
    let _ = app.emit("player-skip-info-updated", ());
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
pub fn player_get_seek_thumbnail(
    state: State<DesktopState>,
    time_pos: f64,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    if !*state.seek_thumbnail_enabled.lock().unwrap() {
        return Ok(String::new());
    }
    let url = state
        .thumb_url
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "no url".to_string())?;

    let mut renderer_guard = state.thumbnail_renderer.lock().unwrap();
    let mut loaded_url_guard = state.thumbnail_loaded_url.lock().unwrap();

    if renderer_guard.is_none() {
        *renderer_guard = Some(mpv_render::MpvRenderer::new_thumbnail()?);
    }
    let renderer = renderer_guard.as_mut().unwrap();

    if loaded_url_guard.as_deref() != Some(url.as_str()) {
        renderer.load_thumbnail(&url)?;
        *loaded_url_guard = Some(url.clone());
        for _ in 0..50 {
            if renderer.query_property("duration").is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    renderer.seek_to(time_pos)?;
    for _ in 0..40 {
        if renderer.query_property("seeking").as_deref() != Some("yes") {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    let pixels = renderer.render_thumbnail(320, 180)?;
    drop(renderer_guard);
    drop(loaded_url_guard);

    let img = image::ImageBuffer::<image::Rgba<u8>, Vec<u8>>::from_raw(320, 180, pixels)
        .ok_or_else(|| "frame buffer mismatch".to_string())?;
    let rgb = image::DynamicImage::ImageRgba8(img).to_rgb8();
    let mut jpeg: Vec<u8> = Vec::new();
    rgb.write_to(
        &mut std::io::Cursor::new(&mut jpeg),
        image::ImageFormat::Jpeg,
    )
    .map_err(|e| e.to_string())?;

    Ok(format!(
        "data:image/jpeg;base64,{}",
        general_purpose::STANDARD.encode(&jpeg)
    ))
}
