// Windows native player surface — libmpv OpenGL render API via ANGLE/EGL.
//
// Architecture mirrors linux_player_surface.rs:
//   • A child HWND (CS_OWNDC, no message loop needed) is created inside the
//     Tauri window and placed at HWND_BOTTOM so it sits behind WebView2.
//   • A dedicated render thread owns the ANGLE/EGL context (see windows_egl.rs)
//     and calls mpv_render_context_render every 16 ms, then eglSwapBuffers.
//   • A status-polling loop detects EOF / errors and emits Tauri events so
//     the frontend can act identically to the Linux code path.
//   • Player controls live in the WebView overlay (transparent background CSS).

use crate::windows_egl::{self, EglContext};
use crate::DesktopState;
use std::sync::atomic::Ordering;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::Foundation::{FALSE, HWND, RECT};
use windows_sys::Win32::Graphics::Dwm::{
    DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
};
use windows_sys::Win32::Graphics::Gdi::HDC;
use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, GetDC};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::ColorSystem::GetICMProfileW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, PeekMessageW,
    RegisterClassExW, SetWindowPos, ShowWindow, TranslateMessage, CS_HREDRAW, CS_OWNDC, CS_VREDRAW,
    HWND_BOTTOM, MSG, PM_REMOVE, SWP_NOACTIVATE, SW_HIDE, SW_SHOW, WNDCLASSEXW, WS_CHILD,
    WS_CLIPCHILDREN,
};

unsafe fn set_window_blur_behind(hwnd: HWND, enable: bool) {
    let region = if enable {
        CreateRectRgn(0, 0, -1, -1)
    } else {
        0
    };
    let bb = DWM_BLURBEHIND {
        dwFlags: if enable {
            DWM_BB_ENABLE | DWM_BB_BLURREGION
        } else {
            DWM_BB_ENABLE
        },
        fEnable: if enable { 1 } else { 0 },
        hRgnBlur: region,
        fTransitionOnMaximized: 0,
    };
    DwmEnableBlurBehindWindow(hwnd, &bb);
    if region != 0 {
        DeleteObject(region);
    }
}

fn schedule_parent_blur(app: &AppHandle, parent_hwnd: HWND, enable: bool) {
    let app = app.clone();
    let _ = app.run_on_main_thread(move || {
        unsafe { set_window_blur_behind(parent_hwnd, enable) };
    });
}

fn main_window_client_size(app: &AppHandle) -> Option<(i32, i32)> {
    let state = app.state::<DesktopState>();
    let packed = state
        .main_window_size
        .load(std::sync::atomic::Ordering::Acquire);
    if packed == 0 {
        return None;
    }
    let width = (packed >> 32) as u32 as i32;
    let height = (packed & 0xFFFF_FFFF) as u32 as i32;
    Some((width.max(2), height.max(2)))
}

fn query_icm_profile(hdc: HDC) -> Option<Vec<u8>> {
    let mut size: u32 = 0;
    unsafe { GetICMProfileW(hdc, &mut size, std::ptr::null_mut()) };
    if size == 0 {
        return None;
    }
    let mut buf: Vec<u16> = vec![0; size as usize];
    let ok = unsafe { GetICMProfileW(hdc, &mut size, buf.as_mut_ptr()) };
    if ok == FALSE {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let path = String::from_utf16_lossy(&buf[..len]);
    std::fs::read(path).ok()
}

fn ensure_renderer_for_surface(app: &AppHandle, hdc: HDC) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let mut renderer = state.player_renderer.lock().unwrap();
    if renderer.is_none() {
        log::warn!("player surface: renderer missing, recreating before load");
        let mut fresh =
            crate::mpv_render::MpvRenderer::new().map_err(|e| format!("mpv init failed: {e}"))?;
        fresh
            .prepare_opengl_context()
            .map_err(|e| format!("mpv GL context failed: {e}"))?;
        if hdc != 0 {
            if let Some(icc) = query_icm_profile(hdc) {
                if let Err(e) = fresh.set_icc_profile(&icc) {
                    log::warn!("failed to set ICC profile: {e}");
                }
            }
        }
        *renderer = Some(fresh);
    }
    Ok(())
}

enum SurfaceCommand {
    Load {
        url: String,
        start_at: Option<u64>,
        total_duration: Option<u64>,
    },
    Hide,
    ShowLoading {
        title: String,
        episode_title: Option<String>,
    },
    SetTitle {
        title: String,
        episode_title: Option<String>,
    },
    SetArtwork {
        title: String,
        episode_title: Option<String>,
        background: Option<(Vec<u8>, i32, i32)>,
        logo: Option<(Vec<u8>, i32, i32)>,
    },
}

#[derive(Clone)]
pub struct NativePlayerSurface {
    sender: mpsc::Sender<SurfaceCommand>,
}

impl NativePlayerSurface {
    pub fn load(
        &self,
        url: String,
        start_at: Option<u64>,
        total_duration: Option<u64>,
    ) -> Result<(), String> {
        self.sender
            .send(SurfaceCommand::Load {
                url,
                start_at,
                total_duration,
            })
            .map_err(|e| format!("surface unavailable: {e}"))
    }
    pub fn hide(&self) {
        let _ = self.sender.send(SurfaceCommand::Hide);
    }
    pub fn show_loading(&self, title: String, episode_title: Option<String>) {
        let _ = self.sender.send(SurfaceCommand::ShowLoading {
            title,
            episode_title,
        });
    }
    pub fn set_title(&self, title: String, episode_title: Option<String>) {
        let _ = self.sender.send(SurfaceCommand::SetTitle {
            title,
            episode_title,
        });
    }
    pub fn set_artwork(
        &self,
        title: String,
        episode_title: Option<String>,
        background: Option<(Vec<u8>, i32, i32)>,
        logo: Option<(Vec<u8>, i32, i32)>,
    ) {
        let _ = self.sender.send(SurfaceCommand::SetArtwork {
            title,
            episode_title,
            background,
            logo,
        });
    }
}

enum InstallSlot {
    NotStarted,
    InProgress(mpsc::Receiver<Result<NativePlayerSurface, String>>),
    Done(Result<NativePlayerSurface, String>),
}

static INSTALL: Mutex<InstallSlot> = Mutex::new(InstallSlot::NotStarted);

fn reset_install_slot() {
    *INSTALL.lock().unwrap() = InstallSlot::NotStarted;
}

pub fn install(app_handle: AppHandle) -> Result<NativePlayerSurface, String> {
    let mut slot = INSTALL.lock().unwrap();
    let rx = match std::mem::replace(&mut *slot, InstallSlot::NotStarted) {
        InstallSlot::Done(result) => {
            *slot = InstallSlot::Done(result.clone());
            return result;
        }
        InstallSlot::InProgress(rx) => rx,
        InstallSlot::NotStarted => {
            let (result_tx, result_rx) = mpsc::channel();
            spawn_install_thread(app_handle, result_tx);
            result_rx
        }
    };
    match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(result) => {
            *slot = match &result {
                Ok(_) => InstallSlot::Done(result.clone()),
                Err(_) => InstallSlot::NotStarted,
            };
            result
        }
        Err(RecvTimeoutError::Timeout) => {
            *slot = InstallSlot::InProgress(rx);
            Err("Windows player surface setup timed out".to_string())
        }
        Err(RecvTimeoutError::Disconnected) => {
            *slot = InstallSlot::NotStarted;
            Err("Windows player surface install thread exited unexpectedly".to_string())
        }
    }
}

fn spawn_install_thread(
    app_handle: AppHandle,
    setup_tx: mpsc::Sender<Result<NativePlayerSurface, String>>,
) {
    let (sender, receiver) = mpsc::channel::<SurfaceCommand>();

    let window = match app_handle.get_webview_window("main") {
        Some(w) => w,
        None => {
            let _ = setup_tx.send(Err("main window not found".to_string()));
            return;
        }
    };

    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let parent_hwnd: HWND = match window.window_handle() {
        Ok(handle) => match handle.as_ref() {
            RawWindowHandle::Win32(h) => h.hwnd.get() as HWND,
            _ => {
                let _ = setup_tx.send(Err("unexpected window handle type on Windows".to_string()));
                return;
            }
        },
        Err(e) => {
            let _ = setup_tx.send(Err(e.to_string()));
            return;
        }
    };

    let app = app_handle;

    std::thread::spawn(move || {
        log::info!("player surface: install thread starting");
        // Register the OpenGL-capable window class once per process.
        static CLASS_REGISTERED: OnceLock<()> = OnceLock::new();
        CLASS_REGISTERED.get_or_init(|| {
            let class_name: Vec<u16> = "FluxaPlayerGL\0".encode_utf16().collect();
            let mut wc: WNDCLASSEXW = unsafe { std::mem::zeroed() };
            wc.cbSize = std::mem::size_of::<WNDCLASSEXW>() as u32;
            wc.style = CS_OWNDC | CS_HREDRAW | CS_VREDRAW;
            wc.lpfnWndProc = Some(DefWindowProcW);
            wc.hInstance = unsafe { GetModuleHandleW(std::ptr::null()) };
            wc.lpszClassName = class_name.as_ptr();
            unsafe { RegisterClassExW(&wc) };
        });

        // Initial size from parent.
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        unsafe { GetClientRect(parent_hwnd, &mut rect) };
        let init_w = (rect.right - rect.left).max(2);
        let init_h = (rect.bottom - rect.top).max(2);

        // Create the child HWND that mpv will render into.
        let class_name: Vec<u16> = "FluxaPlayerGL\0".encode_utf16().collect();
        let child_hwnd = unsafe {
            CreateWindowExW(
                0,
                class_name.as_ptr(),
                std::ptr::null(),
                // No WS_VISIBLE — shown only when player is active.
                WS_CHILD | WS_CLIPCHILDREN,
                0,
                0,
                init_w,
                init_h,
                parent_hwnd,
                0,
                GetModuleHandleW(std::ptr::null()),
                std::ptr::null(),
            )
        };
        if child_hwnd == 0 {
            log::error!("player surface: CreateWindowExW failed for mpv surface");
            let _ = setup_tx.send(Err("CreateWindowExW failed for mpv surface".to_string()));
            return;
        }

        // Place the child window behind WebView2 in Z-order.
        unsafe {
            SetWindowPos(
                child_hwnd,
                HWND_BOTTOM,
                0,
                0,
                init_w,
                init_h,
                SWP_NOACTIVATE,
            );
        }

        // ANGLE/EGL context setup (GLES-over-D3D11) — gives mpv's D3D11VA hwdec a
        // device to attach to, which plain WGL never can.
        let egl: EglContext = match windows_egl::create_window_context(child_hwnd) {
            Ok(ctx) => ctx,
            Err(e) => {
                log::error!("player surface: ANGLE/EGL context creation failed: {e}");
                let _ = setup_tx.send(Err(format!("ANGLE/EGL context creation failed: {e}")));
                return;
            }
        };

        // Kept around only for GetICMProfileW; not used for GL anymore.
        let hdc = unsafe { GetDC(child_hwnd) };

        let vsync_enabled = egl.set_swap_interval(1);
        if !vsync_enabled {
            log::warn!("eglSwapInterval unavailable; falling back to timer-paced rendering");
        }

        // mpv renderer init
        if let Err(e) = ensure_renderer_for_surface(&app, hdc) {
            log::error!("player surface: renderer setup failed: {e}");
            let _ = setup_tx.send(Err(e));
            return;
        }
        log::info!("player surface: MpvRenderer ready");

        log::info!("player surface: setup complete, entering render loop");
        let _ = setup_tx.send(Ok(NativePlayerSurface {
            sender: sender.clone(),
        }));

        // Render + command loop
        let mut visible = false;
        let mut last_size = (init_w, init_h);
        let mut last_render_error: Option<String> = None;
        let mut consecutive_render_errors = 0u32;

        'render: loop {
            unsafe {
                let mut msg: MSG = std::mem::zeroed();
                while PeekMessageW(&mut msg, 0, 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }

            // Drain command channel.
            while let Ok(cmd) = receiver.try_recv() {
                match cmd {
                    SurfaceCommand::Load { url, start_at, .. } => {
                        log::info!("player surface: loading url={url} start_at={start_at:?}");
                        schedule_parent_blur(&app, parent_hwnd, false);
                        unsafe {
                            ShowWindow(child_hwnd, SW_SHOW);
                        }
                        unsafe {
                            SetWindowPos(
                                child_hwnd,
                                HWND_BOTTOM,
                                0,
                                0,
                                last_size.0,
                                last_size.1,
                                SWP_NOACTIVATE,
                            )
                        };
                        visible = true;
                        let _ = app.emit("native-player-show", ());
                        let state = app.state::<DesktopState>();
                        state.pending_hide.store(false, Ordering::Release);
                        *state.eof_next_fired.lock().unwrap() = false;
                        if let Err(e) = ensure_renderer_for_surface(&app, hdc) {
                            log::error!(
                                "player surface: renderer recreate failed before load: {e}"
                            );
                            let _ = app.emit("native-player-error", e);
                            visible = false;
                            unsafe { ShowWindow(child_hwnd, SW_HIDE) };
                            continue;
                        }
                        let mut renderer = state.player_renderer.lock().unwrap();
                        if let Some(r) = renderer.as_mut() {
                            if let Err(e) = r.load(&url, start_at) {
                                log::error!("player surface: load() failed: {e}");
                                drop(renderer);
                                let _ = app.emit("native-player-error", e);
                                visible = false;
                                unsafe { ShowWindow(child_hwnd, SW_HIDE) };
                            } else {
                                log::info!("player surface: load() command accepted by mpv");
                            }
                        } else {
                            log::error!(
                                "player surface: Load command received but renderer is None"
                            );
                            let _ = app.emit(
                                "native-player-error",
                                "player renderer is unavailable".to_string(),
                            );
                            visible = false;
                            unsafe { ShowWindow(child_hwnd, SW_HIDE) };
                        }
                    }
                    SurfaceCommand::Hide => {
                        visible = false;
                        unsafe {
                            ShowWindow(child_hwnd, SW_HIDE);
                        }
                        schedule_parent_blur(&app, parent_hwnd, true);
                        let _ = app.emit("native-player-hide", ());
                        let state = app.state::<DesktopState>();
                        let guard = state.player_renderer.lock().unwrap();
                        if let Some(r) = guard.as_ref() {
                            let _ = r.command_string("stop");
                        }
                    }
                    SurfaceCommand::ShowLoading {
                        title,
                        episode_title,
                    } => {
                        // The WebView overlay renders the loading screen; just push the
                        // title so it can show instantly before the file URL is resolved.
                        let _ = app.emit(
                            "native-player-title",
                            serde_json::json!({ "title": title, "episodeTitle": episode_title }),
                        );
                    }
                    SurfaceCommand::SetTitle {
                        title,
                        episode_title,
                    } => {
                        // Emit to the WebView overlay so it can update its UI.
                        let _ = app.emit(
                            "native-player-title",
                            serde_json::json!({ "title": title, "episodeTitle": episode_title }),
                        );
                    }
                    SurfaceCommand::SetArtwork { title, .. } => {
                        let _ =
                            app.emit("native-player-title", serde_json::json!({ "title": title }));
                    }
                }
            }

            if visible {
                let state = app.state::<DesktopState>();
                if state.pending_hide.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(16));
                    continue;
                }

                let (nw, nh) = main_window_client_size(&app).unwrap_or(last_size);
                if (nw, nh) != last_size {
                    last_size = (nw, nh);
                    log::info!("player surface: resizing render surface to {nw}x{nh}");
                    unsafe {
                        SetWindowPos(child_hwnd, HWND_BOTTOM, 0, 0, nw, nh, SWP_NOACTIVATE);
                    }
                }

                egl.poll_resize();
                {
                    let Ok(mut renderer) = state.player_renderer.try_lock() else {
                        std::thread::sleep(Duration::from_millis(16));
                        continue;
                    };
                    if let Some(r) = renderer.as_mut() {
                        if let Err(e) = r.render_opengl_frame(nw, nh) {
                            consecutive_render_errors = consecutive_render_errors.saturating_add(1);
                            if last_render_error.as_deref() != Some(e.as_str()) {
                                log::error!("player surface: render_opengl_frame failed: {e}");
                                last_render_error = Some(e.clone());
                            }
                            if consecutive_render_errors >= 30 {
                                log::error!("player surface: too many render failures; switching to software video rendering");
                                unsafe { ShowWindow(child_hwnd, SW_HIDE) };
                                let state = app.state::<DesktopState>();
                                *state.native_player_surface.lock().unwrap() = None;
                                reset_install_slot();
                                r.reset_render_context();
                                let _ = app.emit(
                                    "native-player-software-rendering",
                                    format!("Windows native player render failed repeatedly: {e}"),
                                );
                                drop(renderer);
                                break 'render;
                            }
                        } else {
                            last_render_error = None;
                            consecutive_render_errors = 0;
                        }
                    }
                }
                let swap_start = std::time::Instant::now();
                egl.swap_buffers();
                if !vsync_enabled || swap_start.elapsed() < Duration::from_millis(4) {
                    std::thread::sleep(Duration::from_millis(16));
                }
                if let Ok(renderer) = state.player_renderer.try_lock() {
                    if let Some(r) = renderer.as_ref() {
                        r.report_swap();
                    }
                }

                check_player_events(&app);
            } else {
                std::thread::sleep(Duration::from_millis(16));
            }
        }

        drop(egl);
        unsafe { DestroyWindow(child_hwnd) };
        log::info!("player surface: render thread exiting, ANGLE/EGL context released");
    });
}

fn check_player_events(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    let events = {
        let Ok(mut renderer) = state.player_renderer.try_lock() else {
            return;
        };
        match renderer.as_mut() {
            Some(r) => r.poll_events(),
            None => return,
        }
    };
    for event in events {
        let crate::mpv_render::PlayerEvent::EndFile { eof, error } = event;
        log::info!("player surface: mpv END_FILE event eof={eof} error={error:?}");
        if let Some(message) = error {
            log::error!("player surface: stream failed to play: {message}");
            let _ = app.emit("native-player-error", message);
            continue;
        }
        if !eof {
            continue;
        }
        let next_sub = state.next_ep_subtitle.lock().unwrap().clone();
        let auto_play = *state.auto_play_next_episode.lock().unwrap();
        if !next_sub.is_empty() && auto_play {
            log::info!("player surface: eof reached, auto-playing next episode");
            let _ = app.emit("native-player-next-episode", ());
        } else {
            log::info!("player surface: eof reached, closing player");
            let _ = app.emit("native-player-close-requested", ());
        }
    }
}

// Image scaling helpers — mirrors the Linux versions so artwork decoding works
// on Windows too.

pub fn scale_artwork_cover(
    bytes: Vec<u8>,
    target_w: u32,
    target_h: u32,
) -> Option<(Vec<u8>, i32, i32)> {
    let img = image::load_from_memory(&bytes).ok()?;
    let filled = img.resize_to_fill(target_w, target_h, image::imageops::FilterType::Triangle);
    let rgba = filled.to_rgba8();
    Some((rgba.into_raw(), target_w as i32, target_h as i32))
}

pub fn scale_artwork_fit(bytes: Vec<u8>, max_w: u32, max_h: u32) -> Option<(Vec<u8>, i32, i32)> {
    let img = image::load_from_memory(&bytes).ok()?;
    let resized = img.resize(max_w, max_h, image::imageops::FilterType::Triangle);
    let (rw, rh) = (resized.width(), resized.height());
    let rgba = resized.to_rgba8();
    Some((rgba.into_raw(), rw as i32, rh as i32))
}
