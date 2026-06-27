import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { storageRead, storageWrite } from './engine';

type WindowGeometry = { width: number; height: number; x: number; y: number };

let suppressed = false;

export function setSuppressWindowGeometrySave(value: boolean): void {
  suppressed = value;
}

export async function restoreWindowGeometry(): Promise<void> {
  const geometry = await storageRead<WindowGeometry>('windowGeometry');
  if (!geometry) return;
  const win = getCurrentWindow();
  try {
    if (await win.isFullscreen()) return;
    await win.setSize(new PhysicalSize(geometry.width, geometry.height));
    await win.setPosition(new PhysicalPosition(geometry.x, geometry.y));
  } catch { /* ignore */ }
}

export function watchWindowGeometry(): () => void {
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    if (suppressed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        if (await win.isFullscreen()) return;
        const size = await win.outerSize();
        const pos = await win.outerPosition();
        await storageWrite('windowGeometry', { width: size.width, height: size.height, x: pos.x, y: pos.y });
      } catch { /* ignore */ }
    }, 500);
  };

  let unlistenResize: (() => void) | null = null;
  let unlistenMove: (() => void) | null = null;
  void win.onResized(save).then((f) => { unlistenResize = f; });
  void win.onMoved(save).then((f) => { unlistenMove = f; });

  return () => {
    if (timer) clearTimeout(timer);
    unlistenResize?.();
    unlistenMove?.();
  };
}
