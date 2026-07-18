import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { coreInvoke, coreParseVideoId, coreSimklLookupIdForType, coreSimklMatchEpisode, coreSimklScrobbleAction, coreSimklScrobbleBody, coreTraktScrobblePlan } from './engine';
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

  void (async () => {
    const context = await coreInvoke<{ videoId: string; isEpisode: boolean; season: number; episode: number; traktEnabled: boolean }>('scrobbleMediaContext', JSON.stringify({ meta, episode, profile, nowSeconds: Math.floor(Date.now() / 1000) }));
    if (!context?.traktEnabled) return;
    const plan = await coreTraktScrobblePlan(
      context.videoId,
      context.isEpisode,
      context.isEpisode ? context.season : null,
      context.isEpisode ? context.episode : null,
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

export function simklScrobbleOnClose(
  profile: UserProfile | null,
  meta: Meta | null,
  episode: Video | null,
  timePosSec: number,
  durationSec: number,
  onTokenRevoked?: (profile: UserProfile) => void,
): void {
  if (!profile?.simklAccessToken || !meta) return;

  const token = profile.simklAccessToken;

  void (async () => {
    const context = await coreInvoke<{ videoId: string; isEpisode: boolean; simklType: string; season: number; episode: number; releaseDate?: string; episodeTitle: string }>('scrobbleMediaContext', JSON.stringify({ meta, episode, profile, nowSeconds: Math.floor(Date.now() / 1000) }));
    if (!context) return;
    const action = await coreSimklScrobbleAction(timePosSec, durationSec);
    const parsed = await coreParseVideoId(context.videoId);
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
    const lookupJson = lookupRes.ok ? await lookupRes.json() : [];
    const simklId = await coreSimklLookupIdForType(JSON.stringify(lookupJson), context.simklType);
    const ids: Record<string, unknown> = simklId != null ? { simkl: simklId } : { imdb: baseId };

    let scrobbleSeason = context.season;
    let scrobbleNumber = context.episode;

    if (context.isEpisode && simklId != null) {
      const epRes = await tauriFetch(
        `https://api.simkl.com/tv/${simklId}/episodes?${simklQuery}`,
        { headers: authHeaders },
      );
      if (epRes.ok) {
        const epList = await epRes.json() as Array<{ season?: number; episode?: number; date?: string; title?: string }>;
        const matched = await coreSimklMatchEpisode(
          JSON.stringify(Array.isArray(epList) ? epList : []),
          JSON.stringify({ releaseDate: context.releaseDate ?? '', title: context.episodeTitle }),
        );
        if (matched) {
          scrobbleSeason = matched.season;
          scrobbleNumber = matched.episode;
        }
      }
    }

    const body = await coreSimklScrobbleBody(
      JSON.stringify(ids),
      context.isEpisode,
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
