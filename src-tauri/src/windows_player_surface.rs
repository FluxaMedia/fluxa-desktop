// Windows native player surface — libmpv OpenGL render API via WGL.
//
// Architecture mirrors linux_player_surface.rs:
//   • A child HWND (CS_OWNDC, no message loop needed) is created inside the
//     Tauri window and placed at HWND_BOTTOM so it sits behind WebView2.
//   • A dedicated render thread owns the WGL context and calls
//     mpv_render_context_render every 16 ms, then SwapBuffers.
//   • A status-polling loop detects EOF / errors and emits Tauri events so
//     the frontend can act identically to the Linux code path.
//   • Player controls live in the WebView overlay (transparent background CSS).

use crate::DesktopState;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::Foundation::{FALSE, HWND, RECT};
use windows_sys::Win32::Graphics::Gdi::GetDC;
use windows_sys::Win32::Graphics::OpenGL::{
    ChoosePixelFormat, SetPixelFormat, SwapBuffers, PIXELFORMATDESCRIPTOR,
    PFD_DOUBLEBUFFER, PFD_DRAW_TO_WINDOW, PFD_SUPPORT_OPENGL, PFD_TYPE_RGBA,
    wglCreateContext, wglDeleteContext, wglGetProcAddress, wglMakeCurrent,
};
use windows_sys::Win32::Graphics::Gdi::HDC;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::ColorSystem::GetICMProfileW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, GetClientRect, RegisterClassExW, SetWindowPos, ShowWindow,
    CS_HREDRAW, CS_OWNDC, CS_VREDRAW, HWND_BOTTOM, SW_HIDE, SW_SHOW, SWP_NOACTIVATE,
    WNDCLASSEXW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
};


// A bare wglCreateContext() can hand back a context too old for libplacebo's
// GPU-next renderer; upgrade to a real OpenGL 3.3 context where possible.
unsafe fn create_modern_gl_context(hdc: HDC) -> Option<isize> {
    let name = b"wglCreateContextAttribsARB\0";
    let proc = wglGetProcAddress(name.as_ptr())?;
    type CreateContextAttribsArb = unsafe extern "system" fn(HDC, isize, *const i32) -> isize;
    let create: CreateContextAttribsArb = std::mem::transmute(proc);

    const WGL_CONTEXT_MAJOR_VERSION_ARB: i32 = 0x2091;
    const WGL_CONTEXT_MINOR_VERSION_ARB: i32 = 0x2092;
    const WGL_CONTEXT_PROFILE_MASK_ARB: i32 = 0x9126;
    const WGL_CONTEXT_COMPATIBILITY_PROFILE_BIT_ARB: i32 = 0x0002;

    let attribs = [
        WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
        WGL_CONTEXT_MINOR_VERSION_ARB, 3,
        WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_COMPATIBILITY_PROFILE_BIT_ARB,
        0,
    ];
    let ctx = create(hdc, 0, attribs.as_ptr());
    if ctx == 0 { None } else { Some(ctx) }
}

unsafe fn enable_vsync() -> bool {
    let name = b"wglSwapIntervalEXT\0";
    let Some(proc) = wglGetProcAddress(name.as_ptr()) else {
        return false;
    };
    let set_swap_interval: extern "system" fn(i32) -> i32 = std::mem::transmute(proc);
    set_swap_interval(1) != FALSE
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

enum SurfaceCommand {
    Load { url: String, start_at: Option<u64>, total_duration: Option<u64> },
    Hide,
    ShowLoading { title: String, episode_title: Option<String> },
    SetTitle { title: String, episode_title: Option<String> },
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
    pub fn load(&self, url: String, start_at: Option<u64>, total_duration: Option<u64>) -> Result<(), String> {
        self.sender
            .send(SurfaceCommand::Load { url, start_at, total_duration })
            .map_err(|e| format!("surface unavailable: {e}"))
    }
    pub fn hide(&self) {
        let _ = self.sender.send(SurfaceCommand::Hide);
    }
    pub fn show_loading(&self, title: String, episode_title: Option<String>) {
        let _ = self
            .sender
            .send(SurfaceCommand::ShowLoading { title, episode_title });
    }
    pub fn set_title(&self, title: String, episode_title: Option<String>) {
        let _ = self.sender
            .send(SurfaceCommand::SetTitle { title, episode_title });
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

// A timed-out caller must not spawn a second install thread — that races the
// still-running first one over the same mpv render context and segfaults.
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
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(result) => {
            *slot = InstallSlot::Done(result.clone());
            result
        }
        Err(RecvTimeoutError::Timeout) => {
            *slot = InstallSlot::InProgress(rx);
            Err("Windows player surface setup timed out".to_string())
        }
        Err(RecvTimeoutError::Disconnected) => {
            Err("Windows player surface install thread exited unexpectedly".to_string())
        }
    }
}

fn spawn_install_thread(app_handle: AppHandle, setup_tx: mpsc::Sender<Result<NativePlayerSurface, String>>) {
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
                WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
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
            SetWindowPos(child_hwnd, HWND_BOTTOM, 0, 0, init_w, init_h, SWP_NOACTIVATE);
        }

        // WGL context setup
        let hdc = unsafe { GetDC(child_hwnd) };
        if hdc == 0 {
            log::error!("player surface: GetDC failed");
            let _ = setup_tx.send(Err("GetDC failed".to_string()));
            return;
        }

        let mut pfd: PIXELFORMATDESCRIPTOR = unsafe { std::mem::zeroed() };
        pfd.nSize = std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u16;
        pfd.nVersion = 1;
        pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
        pfd.iPixelType = PFD_TYPE_RGBA;
        pfd.cColorBits = 32;
        pfd.cDepthBits = 24;
        pfd.cStencilBits = 8;

        let pf_idx = unsafe { ChoosePixelFormat(hdc, &pfd) };
        if pf_idx == 0 {
            log::error!("player surface: ChoosePixelFormat failed");
            let _ = setup_tx.send(Err("ChoosePixelFormat failed".to_string()));
            return;
        }
        if unsafe { SetPixelFormat(hdc, pf_idx, &pfd) } == FALSE {
            log::error!("player surface: SetPixelFormat failed");
            let _ = setup_tx.send(Err("SetPixelFormat failed".to_string()));
            return;
        }

        let hglrc = unsafe { wglCreateContext(hdc) };
        if hglrc == 0 {
            log::error!("player surface: wglCreateContext failed");
            let _ = setup_tx.send(Err("wglCreateContext failed".to_string()));
            return;
        }
        if unsafe { wglMakeCurrent(hdc, hglrc) } == FALSE {
            log::error!("player surface: wglMakeCurrent failed");
            unsafe { wglDeleteContext(hglrc) };
            let _ = setup_tx.send(Err("wglMakeCurrent failed".to_string()));
            return;
        }

        let hglrc = match unsafe { create_modern_gl_context(hdc) } {
            Some(modern) => {
                unsafe {
                    wglMakeCurrent(0 as _, 0 as _);
                    wglDeleteContext(hglrc);
                    wglMakeCurrent(hdc, modern);
                }
                log::info!("player surface: upgraded to a modern OpenGL 3.3 context");
                modern
            }
            None => {
                log::warn!("player surface: wglCreateContextAttribsARB unavailable, using legacy GL context");
                hglrc
            }
        };

        let vsync_enabled = unsafe { enable_vsync() };
        if !vsync_enabled {
            log::warn!("WGL_EXT_swap_control unavailable; falling back to timer-paced rendering");
        }

        // mpv renderer init
        {
            let state = app.state::<DesktopState>();
            let mut renderer = state.player_renderer.lock().unwrap();
            if renderer.is_none() {
                match crate::mpv_render::MpvRenderer::new() {
                    Ok(r) => {
                        log::info!("player surface: MpvRenderer::new() succeeded");
                        *renderer = Some(r);
                    }
                    Err(e) => {
                        log::error!("player surface: MpvRenderer::new() failed: {e}");
                        unsafe {
                            wglMakeCurrent(0 as _, 0 as _);
                            wglDeleteContext(hglrc);
                        }
                        let _ = setup_tx.send(Err(format!("mpv init failed: {e}")));
                        return;
                    }
                }
            }
            if let Some(r) = renderer.as_mut() {
                if let Err(e) = r.prepare_opengl_context() {
                    log::error!("player surface: prepare_opengl_context() failed: {e}");
                    unsafe {
                        wglMakeCurrent(0 as _, 0 as _);
                        wglDeleteContext(hglrc);
                    }
                    let _ = setup_tx.send(Err(format!("mpv GL context failed: {e}")));
                    return;
                }
                if let Some(icc) = query_icm_profile(hdc) {
                    if let Err(e) = r.set_icc_profile(&icc) {
                        log::warn!("failed to set ICC profile: {e}");
                    }
                }
            }
        }

        log::info!("player surface: setup complete, entering render loop");
        let _ = setup_tx.send(Ok(NativePlayerSurface { sender: sender.clone() }));

        // Render + command loop
        let mut visible = false;
        let mut last_size = (init_w, init_h);

        loop {
            // Drain command channel.
            while let Ok(cmd) = receiver.try_recv() {
                match cmd {
                    SurfaceCommand::Load { url, start_at, .. } => {
                        log::info!("player surface: loading url={url} start_at={start_at:?}");
                        unsafe { ShowWindow(child_hwnd, SW_SHOW) };
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
                        *state.eof_next_fired.lock().unwrap() = false;
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
                            log::error!("player surface: Load command received but renderer is None");
                        }
                    }
                    SurfaceCommand::Hide => {
                        visible = false;
                        unsafe { ShowWindow(child_hwnd, SW_HIDE) };
                        let _ = app.emit("native-player-hide", ());
                        let state = app.state::<DesktopState>();
                        let guard = state.player_renderer.lock().unwrap();
                        if let Some(r) = guard.as_ref() {
                            let _ = r.command_string("stop");
                        }
                    }
                    SurfaceCommand::ShowLoading { title, episode_title } => {
                        // The WebView overlay renders the loading screen; just push the
                        // title so it can show instantly before the file URL is resolved.
                        let _ = app.emit(
                            "native-player-title",
                            serde_json::json!({ "title": title, "episodeTitle": episode_title }),
                        );
                    }
                    SurfaceCommand::SetTitle { title, episode_title } => {
                        // Emit to the WebView overlay so it can update its UI.
                        let _ = app.emit(
                            "native-player-title",
                            serde_json::json!({ "title": title, "episodeTitle": episode_title }),
                        );
                    }
                    SurfaceCommand::SetArtwork { title, .. } => {
                        let _ = app.emit("native-player-title", serde_json::json!({ "title": title }));
                    }
                }
            }

            if visible {
                // Keep child window sized to the Tauri window's client area.
                let mut r2: RECT = unsafe { std::mem::zeroed() };
                unsafe { GetClientRect(parent_hwnd, &mut r2) };
                let nw = (r2.right - r2.left).max(2);
                let nh = (r2.bottom - r2.top).max(2);
                if (nw, nh) != last_size {
                    last_size = (nw, nh);
                    unsafe {
                        SetWindowPos(child_hwnd, HWND_BOTTOM, 0, 0, nw, nh, SWP_NOACTIVATE);
                    }
                }

                // Render frame.
                {
                    let state = app.state::<DesktopState>();
                    let mut renderer = state.player_renderer.lock().unwrap();
                    if let Some(r) = renderer.as_mut() {
                        let _ = r.render_opengl_frame(nw, nh);
                    }
                }
                let swap_start = std::time::Instant::now();
                unsafe { SwapBuffers(hdc) };
                if !vsync_enabled || swap_start.elapsed() < Duration::from_millis(4) {
                    std::thread::sleep(Duration::from_millis(16));
                }
                {
                    let state = app.state::<DesktopState>();
                    if let Some(r) = state.player_renderer.lock().unwrap().as_ref() {
                        r.report_swap();
                    };
                }

                check_player_events(&app);
            } else {
                std::thread::sleep(Duration::from_millis(16));
            }
        }
    });
}

fn check_player_events(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    let events = {
        let mut renderer = state.player_renderer.lock().unwrap();
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

pub fn scale_artwork_cover(bytes: Vec<u8>, target_w: u32, target_h: u32) -> Option<(Vec<u8>, i32, i32)> {
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
