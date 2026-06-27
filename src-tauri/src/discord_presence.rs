use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use tauri::State;

const FLUXA_DISCORD_APP_ID: &str = "1518004842860122174";

pub struct DiscordPresenceState {
    client: Mutex<Option<DiscordIpcClient>>,
}

impl Default for DiscordPresenceState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn discord_presence_configure(state: State<DiscordPresenceState>, enabled: bool) {
    let mut guard = state.client.lock().unwrap();
    if let Some(mut old) = guard.take() {
        let _ = old.close();
    }
    if enabled {
        let mut client = DiscordIpcClient::new(FLUXA_DISCORD_APP_ID);
        if client.connect().is_ok() {
            let act = activity::Activity::new().state("Browsing").assets(
                activity::Assets::new()
                    .large_image("logo")
                    .large_text("Fluxa"),
            );
            let _ = client.set_activity(act);
            *guard = Some(client);
        }
    }
}

#[tauri::command]
pub fn discord_presence_update(
    state: State<DiscordPresenceState>,
    title: String,
    detail: Option<String>,
    paused: bool,
    start_unix_secs: Option<i64>,
    poster_url: Option<String>,
) {
    let mut guard = state.client.lock().unwrap();
    let Some(client) = guard.as_mut() else { return };
    let state_text = detail.unwrap_or_else(|| {
        if paused {
            "Paused".to_string()
        } else {
            "Watching".to_string()
        }
    });
    let large_image = poster_url
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "logo".to_string());
    let mut act = activity::Activity::new()
        .details(&title)
        .state(&state_text)
        .assets(
            activity::Assets::new()
                .large_image(&large_image)
                .large_text(&title)
                .small_image("logo")
                .small_text("Fluxa"),
        );
    if let Some(start) = start_unix_secs {
        act = act.timestamps(activity::Timestamps::new().start(start));
    }
    let _ = client.set_activity(act);
}

#[tauri::command]
pub fn discord_presence_set_idle(state: State<DiscordPresenceState>) {
    let mut guard = state.client.lock().unwrap();
    let Some(client) = guard.as_mut() else { return };
    let act = activity::Activity::new().state("Browsing").assets(
        activity::Assets::new()
            .large_image("logo")
            .large_text("Fluxa"),
    );
    let _ = client.set_activity(act);
}

#[tauri::command]
pub fn discord_presence_clear(state: State<DiscordPresenceState>) {
    let mut guard = state.client.lock().unwrap();
    if let Some(client) = guard.as_mut() {
        let _ = client.clear_activity();
    }
}
