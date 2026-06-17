import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getVersion } from '@tauri-apps/api/app';

export let _appVersion = '1';
getVersion().then((v) => { _appVersion = v; }).catch(() => {});

const DEFAULT_TIMEOUT_MS = 12_000;

export async function platformFetch(url: string, init?: RequestInit): Promise<Response> {
  const signal = init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  // Try native fetch first — no IPC overhead, uses the browser's HTTP stack.
  // Stremio-compatible addons require CORS headers (Access-Control-Allow-Origin: *)
  // so this works for all addon catalog/resource requests.
  // Fall back to tauriFetch for authenticated API calls or CORS-restricted endpoints.
  try {
    return await fetch(url, { ...init, signal });
  } catch {
    return tauriFetch(url, { ...init, signal });
  }
}

export async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await platformFetch(url, {
    headers: { 'User-Agent': `Fluxa/${_appVersion}`, ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function tryFetchJson(url: string): Promise<unknown | null> {
  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
}
