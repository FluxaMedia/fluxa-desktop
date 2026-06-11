import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { t } from '../../i18n';
import {
  nuvioPullProfiles,
  nuvioPullAddons,
  nuvioPullLibrary,
  nuvioPullWatchProgress,
  nuvioPullWatchHistory,
  nuvioPullCollections,
  nuvioPullProfileSettings,
  nuvioListAvatars,
  type NuvioAddon,
} from '../../core/nuvioApi';
import { storageWrite, storageRead } from '../../core/engine';
import { platformFetch } from '../../core/httpClient';
import { buildContinueWatching } from '../../core/libraryOps';
import { saveProfile, setActiveProfileId } from '../../core/profiles';
import type { UserProfile } from '../../core/types';
import { S, FONT } from './styles';

interface ImportProgress {
  profile: boolean;
  addons: boolean;
  library: boolean;
  progress: boolean;
  history: boolean;
  collections: boolean;
}

interface NuvioImportViewProps {
  profile: UserProfile;
  onDone: (profile: UserProfile) => void;
}

export function NuvioImportView({ profile, onDone }: NuvioImportViewProps) {
  const [imp, setImp] = useState<ImportProgress>({
    profile: false, addons: false, library: false,
    progress: false, history: false, collections: false,
  });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runImport();
  }, []);

  const mark = (key: keyof ImportProgress) =>
    setImp((prev) => ({ ...prev, [key]: true }));

  const runImport = async () => {
    const token = profile.nuvioAccessToken!;
    const profileIdx = profile.nuvioProfileIndex ?? 1;

    try {
      const [nuvioProfiles, avatarCatalog] = await Promise.all([
        nuvioPullProfiles(token),
        nuvioListAvatars(),
      ]);
      const primary = nuvioProfiles.find((p) => p.profile_index === profileIdx)
        ?? nuvioProfiles[0];

      let avatarUrl: string | undefined = primary?.avatar_url ?? undefined;
      if (!avatarUrl && primary?.avatar_id) {
        const entry = avatarCatalog.find((a) => a.id === primary.avatar_id);
        if (entry?.storage_path) {
          avatarUrl = `https://dpyhjjcoabcglfmgecug.supabase.co/storage/v1/object/public/avatars/${entry.storage_path}`;
        }
      }

      const updatedProfile: UserProfile = {
        ...profile,
        name: profile.name || primary?.name || 'Primary',
        avatarUrl,
        color: primary?.avatar_color_hex ?? undefined,
      };
      mark('profile');

      const [addons, library, watchProgress, watchHistory, collections, profileSettings] =
        await Promise.allSettled([
          nuvioPullAddons(token, profileIdx),
          nuvioPullLibrary(token, profileIdx),
          nuvioPullWatchProgress(token, profileIdx),
          nuvioPullWatchHistory(token, profileIdx),
          nuvioPullCollections(token, profileIdx),
          nuvioPullProfileSettings(token, profileIdx, 'desktop'),
        ]);

      await saveProfile(updatedProfile);
      await setActiveProfileId(updatedProfile.id);
      const suffix = updatedProfile.id.replace(/[^a-zA-Z0-9_-]/g, '_');

      let addonList: NuvioAddon[] = [];
      const manifestIdByUrl = new Map<string, string>();
      if (addons.status === 'fulfilled') {
        addonList = addons.value;
        const enabled = addonList.filter((a) => a.enabled).sort((a, b) => a.sort_order - b.sort_order);

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
        await storageWrite(`addons_${suffix}`, descriptors);
      }
      mark('addons');

      const libKey = `library_${suffix}`;
      const libDoc: Record<string, unknown> = {
        schemaVersion: 2,
        progress: {},
        continueWatching: [],
        watchlist: [],
        watched: {},
      };

      const libraryByContentId = new Map(
        library.status === 'fulfilled'
          ? library.value.map((i) => [i.content_id, i])
          : []
      );

      if (library.status === 'fulfilled') {
        libDoc.watchlist = library.value.map((item) => ({
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
      }
      mark('library');

      if (watchProgress.status === 'fulfilled') {
        const progressMap: Record<string, unknown> = {};
        const sorted = [...watchProgress.value].sort((a, b) => a.last_watched - b.last_watched);

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
        if (needsAddonMeta.length > 0 && addonList.length > 0) {
          const candidates = addonList
            .filter((a) => a.enabled)
            .sort((a, b) => a.sort_order - b.sort_order);
          await Promise.allSettled(
            needsAddonMeta.map(async (e) => {
              for (const addon of candidates) {
                try {
                  const base = addon.url.replace(/\/manifest\.json$/, '');
                  const res = await platformFetch(`${base}/meta/${e.content_type}/${e.content_id}.json`);
                  if (!res.ok) continue;
                  const data = await res.json() as { meta?: AddonMeta };
                  if (data.meta?.name) {
                    addonMetaMap.set(e.content_id, data.meta);
                    break;
                  }
                } catch {
                  // try next addon
                }
              }
            })
          );
        }

        for (const entry of sorted) {
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
            savedAt: new Date(entry.last_watched).toISOString(),
          };
        }
        libDoc.progress = progressMap;
        libDoc.continueWatching = await buildContinueWatching(progressMap);
      }
      mark('progress');

      if (watchHistory.status === 'fulfilled') {
        const watched: Record<string, boolean> = {};
        for (const item of watchHistory.value) {
          if (item.content_type === 'movie') {
            watched[item.content_id] = true;
          } else if (item.season != null && item.episode != null) {
            watched[`${item.content_id}:${item.season}:${item.episode}`] = true;
          }
        }
        libDoc.watched = watched;
      }
      mark('history');

      await storageWrite(libKey, libDoc);

      if (profileSettings.status === 'fulfilled' && profileSettings.value.length > 0) {
        const blob = profileSettings.value[0]?.settings_json;
        if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
          const existing = await storageRead<Record<string, unknown>>('prefs') ?? {};
          await storageWrite('prefs', { ...existing, ...blob as Record<string, unknown> });
        }
      }

      let finalProfile = updatedProfile;
      if (collections.status === 'fulfilled' && collections.value.length > 0) {
        const raw = collections.value[0]?.collections_json ?? [];
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
            shape: (f.tileShape as string | undefined) ?? 'POSTER',
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
        finalProfile = { ...updatedProfile, libraryCollections: mapped };
        await saveProfile(finalProfile);
      }
      mark('collections');

      setDone(true);
      setTimeout(() => onDone(finalProfile), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error.network'));
    }
  };

  const steps: Array<{ key: keyof ImportProgress; label: string }> = [
    { key: 'profile', label: t('auth.nuvio.import.profile') },
    { key: 'addons', label: t('auth.nuvio.import.addons') },
    { key: 'library', label: t('auth.nuvio.import.library') },
    { key: 'progress', label: t('auth.nuvio.import.progress') },
    { key: 'history', label: t('auth.nuvio.import.history') },
    { key: 'collections', label: t('auth.nuvio.import.collections') },
  ];

  return (
    <div style={S.root}>
      <div style={S.topBar}>
        <div>
          <p style={S.logo}>fluxa</p>
          <p style={S.kicker}>{t('app.desktop')}</p>
        </div>
      </div>

      <main style={S.authMain}>
        <div style={{ ...S.card, maxWidth: 360 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
            <img
              src="https://nuvio.tv//assets/Logo_1080x1080.png"
              alt="Nuvio"
              style={{ width: 32, height: 32, objectFit: 'contain' }}
            />
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, fontFamily: FONT }}>
              {done ? t('auth.nuvio.import.done') : t('auth.nuvio.import.title')}
            </p>
          </div>

          {error && <p style={S.globalError}>{error}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {steps.map(({ key, label }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  background: imp[key] ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.08)',
                  border: imp[key] ? 'none' : '1px solid rgba(255,255,255,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.3s',
                }}>
                  {imp[key] && <Check size={11} color="#000" strokeWidth={3} />}
                </div>
                <span style={{
                  fontSize: 13, fontFamily: FONT,
                  color: imp[key] ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.30)',
                  transition: 'color 0.3s',
                }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
