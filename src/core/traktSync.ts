import { platformFetch } from './httpClient';
import { loadActiveProfile } from './libraryOps';
import { invoke } from '@tauri-apps/api/core';
import { coreInvoke } from './engine';

export async function getOAuthClientId(service: string): Promise<string> {
  try {
    return await invoke<string>('get_oauth_client_id', { service });
  } catch {
    return '';
  }
}

export function traktHeaders(token: string, clientId: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'trakt-api-version': '2',
    'trakt-api-key': clientId,
  };
}

export async function dropTraktPlaybackProgress(showId: string): Promise<void> {
  const profile = await loadActiveProfile();
  const token = profile?.traktAccessToken;
  if (!token) return;
  if (profile?.traktTokenExpiresAt && Date.now() / 1000 > profile.traktTokenExpiresAt) return;

  const clientId = await getOAuthClientId('trakt');
  const headers = traktHeaders(token, clientId);

  try {
    const res = await platformFetch('https://api.trakt.tv/sync/playback', { headers });
    if (!res.ok) return;

    const playbackItems = await res.json() as unknown[];
    if (!Array.isArray(playbackItems)) return;

    const deleteIds = await coreInvoke<number[]>('traktPlaybackDeleteIds', JSON.stringify({ contentId: showId, items: playbackItems })) ?? [];
    const deletePromises = deleteIds.map((id) =>
      platformFetch(`https://api.trakt.tv/sync/playback/${id}`, {
        method: 'DELETE',
        headers,
      }).then(() => undefined).catch(() => undefined),
    );

    await Promise.all(deletePromises);
  } catch {
  }
}

export async function enqueueTraktScrobble(payload: Record<string, unknown>): Promise<unknown> {
  const url = payload.url as string | undefined;
  const body = payload.body as unknown;
  const token = payload.token as string | undefined;
  if (!url || !token) return {};
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'trakt-api-version': '2',
        'trakt-api-key': payload.clientId as string,
      },
      body: JSON.stringify(body),
    });
  } catch {
  }
  return {};
}
