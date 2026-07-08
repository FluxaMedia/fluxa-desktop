import {
  nuvioRefreshToken,
  nuvioPullAddons,
  nuvioPullCollections,
  nuvioPullLibrary,
  nuvioPullProfileSettings,
  nuvioPullWatchHistory,
  nuvioPullWatchProgress,
  type NuvioAddon,
  type NuvioAvatar,
  type NuvioProfile,
} from './nuvioApi';
import { platformFetch } from './httpClient';
import { buildContinueWatching } from './libraryOps';
import { storageRead, storageWrite } from './engine';
import type { UserProfile } from './types';
import { saveProfile } from './profiles';
import { fetchPlannedResources } from './fetchPlanning';

export type NuvioImportStep = 'addons' | 'library' | 'progress' | 'history' | 'collections' | 'settings';

export interface NuvioImportReport {
  errors: Partial<Record<NuvioImportStep, string>>;
}

export async function freshNuvioProfile(profile: UserProfile): Promise<UserProfile> {
  if (!profile.nuvioRefreshToken) return profile;
  const expiresAt = profile.nuvioTokenExpiresAt ?? 0;
  if (profile.nuvioAccessToken && expiresAt > Math.floor(Date.now() / 1000) + 60) return profile;
  const session = await nuvioRefreshToken(profile.nuvioRefreshToken);
  const updated: UserProfile = {
    ...profile,
    nuvioAccessToken: session.access_token,
    nuvioRefreshToken: session.refresh_token ?? profile.nuvioRefreshToken,
    nuvioTokenExpiresAt: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    nuvioUserId: session.user?.id ?? profile.nuvioUserId,
  };
  await saveProfile(updated);
  return updated;
}

function normalizeTileShape(value: string | undefined): string {
  const raw = (value ?? 'poster').toLowerCase();
  return raw === 'landscape' ? 'wide' : raw;
}

function safeIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'user';
}

function profileStorageSuffix(profile: UserProfile): string {
  return profile.id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function localNuvioProfileId(profile: UserProfile, index: number): string {
  return `nuvio_${safeIdPart(profile.nuvioUserId ?? profile.nuvioEmail ?? profile.email ?? 'user')}_${index}`;
}

function avatarUrlFor(profile: NuvioProfile | undefined, avatarCatalog: NuvioAvatar[]): string | undefined {
  if (profile?.avatar_url) return profile.avatar_url;
  if (!profile?.avatar_id) return undefined;
  const entry = avatarCatalog.find((a) => a.id === profile.avatar_id);
  return entry?.storage_path
    ? `https://dpyhjjcoabcglfmgecug.supabase.co/storage/v1/object/public/avatars/${entry.storage_path}`
    : undefined;
}

export function buildLocalNuvioProfiles(
  sessionProfile: UserProfile,
  nuvioProfiles: NuvioProfile[],
  avatarCatalog: NuvioAvatar[],
  existingProfiles: UserProfile[],
): UserProfile[] {
  const remoteProfiles = nuvioProfiles.length > 0
    ? nuvioProfiles
    : [{
        id: '',
        user_id: sessionProfile.nuvioUserId ?? '',
        profile_index: 1,
        name: sessionProfile.name || 'Primary',
        avatar_color_hex: null,
        uses_primary_addons: true,
        uses_primary_plugins: true,
        avatar_id: null,
        avatar_url: null,
        pin_enabled: false,
        pin_locked_until: null,
        created_at: '',
        updated_at: '',
      }];

  const byNuvioProfile = new Map(
    existingProfiles
      .filter((p) => p.nuvioUserId === sessionProfile.nuvioUserId && p.nuvioProfileIndex != null)
      .map((p) => [p.nuvioProfileIndex!, p])
  );
  const importedIds = new Set<string>();
  const imported = remoteProfiles.map((remote) => {
    const existing = byNuvioProfile.get(remote.profile_index);
    const id = existing?.id ?? localNuvioProfileId(sessionProfile, remote.profile_index);
    importedIds.add(id);
    return {
      ...existing,
      id,
      name: remote.name || existing?.name || `Profile ${remote.profile_index}`,
      avatarUrl: avatarUrlFor(remote, avatarCatalog) ?? existing?.avatarUrl,
      color: remote.avatar_color_hex ?? existing?.color,
      email: sessionProfile.email,
      nuvioAccessToken: sessionProfile.nuvioAccessToken,
      nuvioRefreshToken: sessionProfile.nuvioRefreshToken,
      nuvioTokenExpiresAt: sessionProfile.nuvioTokenExpiresAt,
      nuvioUserId: sessionProfile.nuvioUserId,
      nuvioEmail: sessionProfile.nuvioEmail,
      nuvioProfileIndex: remote.profile_index,
    } satisfies UserProfile;
  });

  return [
    ...existingProfiles.filter((p) => !importedIds.has(p.id)),
    ...imported,
  ];
}

async function fetchAddonManifests(addons: NuvioAddon[]): Promise<{
  addonList: NuvioAddon[];
  manifestIdByUrl: Map<string, string>;
  descriptors: Array<Record<string, unknown>>;
}> {
  const enabled = addons.filter((a) => a.enabled).sort((a, b) => a.sort_order - b.sort_order);
  const manifestIdByUrl = new Map<string, string>();
  const manifests = await Promise.allSettled(
    enabled.map(async (a) => {
      const res = await platformFetch(a.url);
      if (!res.ok) return null;
      return res.json() as Promise<Record<string, unknown>>;
    })
  );

  const descriptors = enabled.map((a, i) => {
    const mResult = manifests[i];
    const m = mResult.status === 'fulfilled' && mResult.value ? mResult.value : null;
    if (m?.id) manifestIdByUrl.set(a.url, String(m.id));
    return {
      transportUrl: a.url,
      manifest: m ?? { id: a.url, name: a.name ?? a.url, version: '0.0.1', resources: [], types: [], catalogs: [] },
    };
  });

  return { addonList: addons, manifestIdByUrl, descriptors };
}

export async function importNuvioProfileData(
  profile: UserProfile,
  onStep?: (step: NuvioImportStep, ok: boolean, error?: string) => void,
): Promise<NuvioImportReport> {
  const freshProfile = await freshNuvioProfile(profile).catch(() => profile);
  const token = freshProfile.nuvioAccessToken;
  const profileIdx = freshProfile.nuvioProfileIndex ?? 1;
  if (!token) return { errors: { library: 'Missing Nuvio token' } };

  const suffix = profileStorageSuffix(profile);
  const libKey = `library_${suffix}`;
  const existingLib = (await storageRead<Record<string, unknown>>(libKey)) ?? {};
  const libDoc: Record<string, unknown> = {
    schemaVersion: 2,
    ...existingLib,
    progress: { ...((existingLib.progress as Record<string, unknown> | undefined) ?? {}) },
    continueWatching: Array.isArray(existingLib.continueWatching) ? existingLib.continueWatching : [],
    watchlist: Array.isArray(existingLib.watchlist) ? existingLib.watchlist : [],
    watched: { ...((existingLib.watched as Record<string, boolean> | undefined) ?? {}) },
  };
  const errors: Partial<Record<NuvioImportStep, string>> = {};
  const activeRemoteProgressIds = new Set<string>();

  let addonList: NuvioAddon[] = [];
  let manifestIdByUrl = new Map<string, string>();
  let addonDescriptors: Array<Record<string, unknown>> = [];
  try {
    const addons = await nuvioPullAddons(token, profileIdx);
    const fetched = await fetchAddonManifests(addons);
    addonList = fetched.addonList;
    manifestIdByUrl = fetched.manifestIdByUrl;
    addonDescriptors = fetched.descriptors;
    await storageWrite(`addons_${suffix}`, fetched.descriptors);
    onStep?.('addons', true);
  } catch (err) {
    errors.addons = err instanceof Error ? err.message : String(err);
    onStep?.('addons', false, errors.addons);
  }

  const libraryByContentId = new Map<string, {
    content_id: string;
    content_type: string;
    name: string;
    poster: string | null;
    background: string | null;
    description: string | null;
    release_info: string | null;
    imdb_rating: number | null;
    genres: string[];
  }>();

  try {
    const library = await nuvioPullLibrary(token, profileIdx);
    for (const item of library) libraryByContentId.set(item.content_id, item);
    libDoc.watchlist = library.map((item) => ({
      id: item.content_id,
      name: item.name,
      type: item.content_type,
      poster: item.poster ?? undefined,
      background: item.background ?? undefined,
      description: item.description ?? undefined,
      releaseInfo: item.release_info ?? undefined,
      imdbRating: item.imdb_rating ?? undefined,
      genres: item.genres?.length ? item.genres : undefined,
      inWatchlist: true,
    }));
    onStep?.('library', true);
  } catch (err) {
    errors.library = err instanceof Error ? err.message : String(err);
    onStep?.('library', false, errors.library);
  }

  try {
    const watchProgress = await nuvioPullWatchProgress(token, profileIdx);
    const progressMap: Record<string, unknown> = { ...((libDoc.progress as Record<string, unknown> | undefined) ?? {}) };
    const sorted = [...watchProgress].sort((a, b) => a.last_watched - b.last_watched);

    type AddonMeta = {
      name?: string;
      poster?: string;
      background?: string;
      videos?: Array<{ id?: string; title?: string; name?: string; season?: number; episode?: number; thumbnail?: string }>;
    };
    const needsAddonMeta = sorted.filter(
      (e) => e.content_type === 'series' || !libraryByContentId.has(e.content_id)
    );
    const addonMetaMap = new Map<string, AddonMeta>();
    if (needsAddonMeta.length > 0 && addonDescriptors.length > 0) {
      await Promise.allSettled(
        needsAddonMeta.map(async (e) => {
          try {
            const values = await fetchPlannedResources({
              kind: 'metaDetail',
              addons: addonDescriptors,
              contentType: e.content_type,
              id: e.content_id,
            });
            const meta = (values.find((value) => (value as { meta?: unknown }).meta) as { meta?: AddonMeta } | undefined)?.meta;
            if (meta?.name) addonMetaMap.set(e.content_id, meta);
          } catch {}
        })
      );
    }

    for (const entry of sorted) {
      const progressRatio = entry.duration > 0 ? entry.position / entry.duration : 0;
      const isResolvedUpNext = entry.duration <= 0
        ? entry.position <= 1000
        : progressRatio < 0.005 || progressRatio >= 0.995;
      const libItem = libraryByContentId.get(entry.content_id);
      const addonMeta = addonMetaMap.get(entry.content_id);
      const ep = entry.season != null && entry.episode != null
        ? (addonMeta?.videos ?? []).find((v) => v.season === entry.season && v.episode === entry.episode)
        : undefined;
      progressMap[entry.content_id] = {
        meta: {
          id: entry.content_id,
          type: entry.content_type,
          name: libItem?.name ?? addonMeta?.name,
          poster: libItem?.poster ?? addonMeta?.poster ?? undefined,
          background: libItem?.background ?? addonMeta?.background ?? undefined,
        },
        timeOffset: Math.round(entry.position / 1000),
        duration: Math.round(entry.duration / 1000),
        lastVideoId: entry.video_id,
        lastEpisodeSeason: entry.season ?? undefined,
        lastEpisodeNumber: entry.episode ?? undefined,
        lastEpisodeName: ep?.title ?? ep?.name ?? undefined,
        lastEpisodeThumbnail: ep?.thumbnail ?? undefined,
        ...(isResolvedUpNext ? {
          continueWatchingBadge: 'upNext',
          continueWatchingEpisodeResolved: true,
        } : {}),
        savedAt: new Date(entry.last_watched).toISOString(),
        source: 'nuvio',
      };
      activeRemoteProgressIds.add(entry.video_id);
      if (entry.season != null && entry.episode != null) {
        activeRemoteProgressIds.add(`${entry.content_id}:${entry.season}:${entry.episode}`);
      }
    }
    libDoc.progress = progressMap;
    libDoc.continueWatching = await buildContinueWatching(progressMap);
    onStep?.('progress', true);
  } catch (err) {
    errors.progress = err instanceof Error ? err.message : String(err);
    onStep?.('progress', false, errors.progress);
  }

  try {
    const watchHistory = await nuvioPullWatchHistory(token, profileIdx);
    const watched: Record<string, boolean> = { ...((libDoc.watched as Record<string, boolean> | undefined) ?? {}) };
    for (const item of watchHistory) {
      if (item.content_type === 'movie') {
        watched[item.content_id] = true;
      } else if (item.season != null && item.episode != null) {
        watched[`${item.content_id}:${item.season}:${item.episode}`] = true;
      }
    }
    for (const id of activeRemoteProgressIds) {
      delete watched[id];
    }
    libDoc.watched = watched;
    onStep?.('history', true);
  } catch (err) {
    errors.history = err instanceof Error ? err.message : String(err);
    onStep?.('history', false, errors.history);
  }

  {
    const finalWatched = (libDoc.watched as Record<string, boolean> | undefined) ?? {};
    const finalProgress = (libDoc.progress as Record<string, unknown> | undefined) ?? {};
    let dirty = false;
    for (const [contentId, entry] of Object.entries(finalProgress)) {
      const e = entry as Record<string, unknown>;
      const lastVideoId = e.lastVideoId as string | undefined;
      const season = e.lastEpisodeSeason as number | undefined;
      const episode = e.lastEpisodeNumber as number | undefined;
      const isWatched =
        (lastVideoId != null && finalWatched[lastVideoId]) ||
        (season != null && episode != null && finalWatched[`${contentId}:${season}:${episode}`]);
      if (isWatched) {
        delete finalProgress[contentId];
        dirty = true;
      }
    }
    if (dirty) {
      libDoc.progress = finalProgress;
      libDoc.continueWatching = await buildContinueWatching(finalProgress);
    }
  }

  await storageWrite(libKey, libDoc);

  try {
    const profileSettings = await nuvioPullProfileSettings(token, profileIdx, 'desktop');
    const blob = profileSettings[0]?.settings_json;
    if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
      const existing = await storageRead<Record<string, unknown>>('prefs') ?? {};
      await storageWrite('prefs', { ...existing, ...blob as Record<string, unknown> });
    }
    onStep?.('settings', true);
  } catch (err) {
    errors.settings = err instanceof Error ? err.message : String(err);
    onStep?.('settings', false, errors.settings);
  }

  try {
    const collections = await nuvioPullCollections(token, profileIdx);
    if (collections.length > 0) {
      const raw = collections[0]?.collections_json ?? [];
      const mapped = (raw as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.id ?? ''),
        title: String(c.title ?? ''),
        imageUrl: (c.backdropImageUrl as string | undefined) ?? undefined,
        showOnHome: Boolean(c.pinToTop),
        viewMode: (c.viewMode as string | undefined) ?? 'ROWS',
        showAllTab: Boolean(c.showAllTab),
        pinToTop: Boolean(c.pinToTop),
        folders: ((c.folders as Array<Record<string, unknown>>) ?? []).map((f) => ({
          id: String(f.id ?? ''),
          title: String(f.title ?? ''),
          coverImageUrl: (f.coverImageUrl as string | undefined) ?? undefined,
          coverEmoji: (f.coverEmoji as string | undefined) ?? undefined,
          focusGifUrl: (f.focusGifUrl as string | undefined) ?? undefined,
          focusGifEnabled: f.focusGifEnabled !== false,
          titleLogoUrl: (f.titleLogoUrl as string | undefined) ?? undefined,
          shape: normalizeTileShape(f.tileShape as string | undefined),
          hideTitle: Boolean(f.hideTitle),
          catalogSources: ((f.catalogSources as Array<Record<string, unknown>>) ?? []).map((s) => {
            const addonId = String(s.addonId ?? '');
            const matched = addonList.find((a) => {
              const manifestId = manifestIdByUrl.get(a.url);
              return manifestId === addonId || a.url === addonId;
            });
            return {
              transportUrl: matched ? matched.url : addonId,
              catalogId: String(s.catalogId ?? ''),
              type: String(s.type ?? 'movie'),
            };
          }),
        })),
      }));
      const profiles = (await storageRead<UserProfile[]>('profiles')) ?? [];
      await storageWrite('profiles', profiles.map((p) => p.id === profile.id ? { ...p, libraryCollections: mapped } : p));
    }
    onStep?.('collections', true);
  } catch (err) {
    errors.collections = err instanceof Error ? err.message : String(err);
    onStep?.('collections', false, errors.collections);
  }

  return { errors };
}
