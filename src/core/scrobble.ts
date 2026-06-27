import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { coreParseVideoId, coreSimklMatchEpisode, coreSimklScrobbleBody, coreTraktScrobblePlan } from './engine';
import { _appVersion } from './httpClient';
import type { UserProfile, Meta, Video } from './types';

export function traktScrobbleOnClose(
  profile: UserProfile | null,
  meta: Meta | null,
  episode: Video | null,
  timePosSec: number,
  durationSec: number,
): void {
  if (!profile?.traktAccessToken || !meta) return;
  if (profile.traktTokenExpiresAt && Date.now() / 1000 > profile.traktTokenExpiresAt) return;

  const isEpisode = meta.type === 'series' && !!episode;

  void (async () => {
    const plan = await coreTraktScrobblePlan(
      meta.id,
      isEpisode,
      isEpisode ? (episode!.season ?? 1) : null,
      isEpisode ? (episode!.episode ?? episode!.number ?? 1) : null,
      timePosSec,
      durationSec,
    );
    if (!plan) return;

    const clientId = await invoke<string>('get_oauth_client_id', { service: 'trakt' });
    await tauriFetch(`https://api.trakt.tv/scrobble/${plan.action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.traktAccessToken}`,
        'trakt-api-version': '2',
        'trakt-api-key': clientId,
      },
      body: JSON.stringify(plan.body),
    });
  })().catch(() => undefined);
}

const SIMKL_SCROBBLE_STOP_PROGRESS_PERCENT = 80;

export function simklScrobbleOnClose(
  profile: UserProfile | null,
  meta: Meta | null,
  episode: Video | null,
  timePosSec: number,
  durationSec: number,
  onTokenRevoked?: (profile: UserProfile) => void,
): void {
  if (!profile?.simklAccessToken || !meta) return;

  const isEpisode = meta.type === 'series' && !!episode;
  const token = profile.simklAccessToken;
  const progressPercent = durationSec > 0 ? (timePosSec / durationSec) * 100 : 0;
  const action = progressPercent >= SIMKL_SCROBBLE_STOP_PROGRESS_PERCENT ? 'stop' : 'pause';

  void (async () => {
    const parsed = await coreParseVideoId(meta.id);
    const baseId = parsed.imdb;
    if (!baseId) return;

    const clientId = await invoke<string>('get_oauth_client_id', { service: 'simkl' });
    const simklQuery = `client_id=${encodeURIComponent(clientId)}&app-name=fluxa&app-version=${encodeURIComponent(_appVersion)}`;
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    const lookupRes = await tauriFetch(
      `https://api.simkl.com/search/id?imdb=${encodeURIComponent(baseId)}&${simklQuery}`,
      { headers: authHeaders },
    );
    const lookupJson = lookupRes.ok
      ? (await lookupRes.json() as Array<{ type?: string; ids?: Record<string, unknown> }>)
      : [];
    const wantType = isEpisode ? 'tv' : 'movie';
    const found = lookupJson.find((item) => item.type === wantType);
    const simklId = typeof found?.ids?.simkl === 'number' ? found.ids.simkl : null;
    const ids: Record<string, unknown> = simklId != null ? { simkl: simklId } : { imdb: baseId };

    let scrobbleSeason = isEpisode ? (episode!.season ?? 1) : 1;
    let scrobbleNumber = isEpisode ? (episode!.episode ?? episode!.number ?? 1) : 1;

    if (isEpisode && simklId != null) {
      const epRes = await tauriFetch(
        `https://api.simkl.com/tv/${simklId}/episodes?${simklQuery}`,
        { headers: authHeaders },
      );
      if (epRes.ok) {
        const epList = await epRes.json() as Array<{ season?: number; episode?: number; date?: string; title?: string }>;
        const releaseDate = episode!.released?.slice(0, 10);
        const epName = episode!.name ?? episode!.title ?? '';
        const matched = await coreSimklMatchEpisode(
          JSON.stringify(Array.isArray(epList) ? epList : []),
          JSON.stringify({ releaseDate: releaseDate ?? '', title: epName }),
        );
        if (matched) {
          scrobbleSeason = matched.season;
          scrobbleNumber = matched.episode;
        }
      }
    }

    const body = await coreSimklScrobbleBody(
      JSON.stringify(ids),
      isEpisode,
      scrobbleSeason,
      scrobbleNumber,
      timePosSec,
      durationSec,
    );
    if (!body) return;

    const res = await tauriFetch(`https://api.simkl.com/scrobble/${action}?${simklQuery}`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body),
    });
    if (res.status === 401 && onTokenRevoked) {
      onTokenRevoked({ ...profile, simklAccessToken: undefined, simklRefreshToken: undefined });
    }
  })().catch(() => undefined);
}
