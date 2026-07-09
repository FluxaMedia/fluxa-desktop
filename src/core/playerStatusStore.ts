import { invoke } from '@tauri-apps/api/core';
import type { EmbeddedMpvStatus } from './mpvPlayer';

type Listener = (status: EmbeddedMpvStatus) => void;

const listeners = new Set<Listener>();
let timer: number | null = null;
let inFlight = false;

async function poll() {
  if (inFlight) return;
  inFlight = true;
  try {
    const status = await invoke<EmbeddedMpvStatus>('player_status');
    listeners.forEach((listener) => listener(status));
  } catch {
  } finally {
    inFlight = false;
  }
}

export function subscribePlayerStatus(listener: Listener): () => void {
  listeners.add(listener);
  if (timer === null) {
    void poll();
    timer = window.setInterval(() => { void poll(); }, 500);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}
