import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

let permissionGranted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted;
  permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === 'granted';
  }
  return permissionGranted;
}

export async function notify(title: string, body?: string): Promise<void> {
  if (!(await ensurePermission().catch(() => false))) return;
  sendNotification({ title, body });
}
