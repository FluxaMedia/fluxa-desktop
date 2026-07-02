import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HeroSection } from '../components/HeroSection';
import { ShelfRow } from '../components/ShelfRow';
import { CategoryGridScreen } from './CategoryGridScreen';
import { ContinueWatchingRow } from '../components/ContinueWatchingRow';
import { CollectionShelfRow } from '../components/CollectionShelfRow';
import { posterPrefsFromState } from '../core/posterPrefs';
import { appPrefs, prefBool } from '../core/appPrefs';
import { buildResourceUrl } from '../core/addonManifest';
import { httpFetchText } from '../core/engine';
import type { AppState, HomeCategory, Meta } from '../core/types';
import { getLanguage, t } from '../i18n';

interface Props {
  state: AppState;
  onDispatch: (actionJson: string) => void | Promise<void>;
  onNavigateDetail: (meta: Meta) => void;
  onPlay: (meta: Meta) => void;
  onResume: (meta: Meta) => void;
  // Home stays mounted while hidden (it's the heaviest screen — re-mounting it on every
  // visit was costing a visible stutter), so this tells HeroSection to pause its
  // auto-slide interval rather than keep cycling backdrop images forever in the background.
  isActive: boolean;
}

async function loadFolderItems(folderCategory: HomeCategory): Promise<Meta[]> {
  const sources = folderCategory.catalogSources ?? [];
  const batches = await Promise.all(
    sources.map(async (source) => {
      const extraJson = source.genre ? JSON.stringify({ genre: source.genre }) : undefined;
      const url = await buildResourceUrl(source.transportUrl, 'catalog', source.type, source.catalogId, extraJson);
      try {
        const res = await httpFetchText(url);
        if (res.statusCode === 200) {
          const data = JSON.parse(res.body) as { metas?: Meta[] };
          return data?.metas ?? [];
        }
      } catch { /* skip failed source */ }
      return [];
    }),
  );
  return batches.flat();
}

export const HomeScreen = React.memo(function HomeScreen({ state, onDispatch, onNavigateDetail, onPlay, onResume, isActive }: Props) {
  const home = state.home;
  const [viewAllCategory, setViewAllCategory] = useState<{ title: string; items: Meta[] } | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);

  useLayoutEffect(() => {
    if (!viewAllCategory && scrollRef.current) scrollRef.current.scrollTop = savedScrollRef.current;
  }, [viewAllCategory]);

  const handleFolderTileClick = useCallback(async (folderMeta: Meta) => {
    const allCats = (home.categories ?? []) as HomeCategory[];
    const folderCat = allCats.find((c) => c.id === folderMeta.id && c.type === 'collection_folder');
    if (!folderCat?.catalogSources?.length) return;
    savedScrollRef.current = scrollRef.current?.scrollTop ?? 0;
    setViewAllCategory({ title: folderMeta.name, items: [] });
    setFolderLoading(true);
    try {
      const items = await loadFolderItems(folderCat);
      if (items.length) setViewAllCategory({ title: folderMeta.name, items });
      else setViewAllCategory(null);
    } finally {
      setFolderLoading(false);
    }
  }, [home.categories]);

  useEffect(() => {
    const hasData = (home.categories?.length ?? 0) > 0 || !!home.billboard || (home.continueWatching?.length ?? 0) > 0;
    if (!hasData && !home.isLoading) {
      onDispatch(JSON.stringify({ type: 'homeLoadRequested', language: getLanguage() }));
    }
  }, []);

  const continueWatching = useMemo(() => (home.continueWatching ?? []) as Meta[], [home.continueWatching]);
  const categories = useMemo(() => home.categories ?? [], [home.categories]);
  const contentCategories = useMemo(
    () => categories.filter((c) => c.type !== 'collection' && c.type !== 'collection_folder'),
    [categories],
  );
  const billboard = useMemo(
    () => home.billboard ?? contentCategories[0]?.items?.[0] ?? null,
    [home.billboard, contentCategories],
  );
  const heroSlides = useMemo(
    () => buildHeroSlides(billboard, contentCategories.flatMap((c) => c.items)),
    [billboard, contentCategories],
  );
  const posterPrefs = useMemo(() => posterPrefsFromState(state), [state.settings?.values]);
  const prefs = useMemo(() => appPrefs(state), [state.settings?.values]);
  const addonIconByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const addon of state.addons.installed ?? []) {
      if (addon.name && addon.logo) map.set(addon.name, addon.logo);
    }
    return map;
  }, [state.addons.installed]);
  const showHero = prefBool(prefs, 'showHeroSection', true);
  const showContinueWatching = prefBool(prefs, 'continueWatchingEnabled', true);
  const gifAutoplayEnabled = prefBool(prefs, 'gifAutoplayEnabled', true);
  const topTenFeedKeys = useMemo(() => {
    const raw = prefs.topTenFeedToggles;
    return new Set<string>(Array.isArray(raw) ? (raw as string[]) : []);
  }, [prefs.topTenFeedToggles]);

  const handleViewAll = useCallback((title: string, items: Meta[]) => {
    savedScrollRef.current = scrollRef.current?.scrollTop ?? 0;
    setViewAllCategory({ title, items });
  }, []);

  const handleAddToWatchlist = useCallback(
    (meta: Meta) => onDispatch(JSON.stringify({ type: 'libraryAddRequested', meta })),
    [onDispatch],
  );

  const cwSettingsValues = state.settings?.values as Record<string, unknown> | undefined;
  const cwLayout = String(cwSettingsValues?.resolvedContinueWatchingLayout ?? cwSettingsValues?.continueWatchingLayout ?? 'horizontal');
  const cwArtwork = String(cwSettingsValues?.continueWatchingArtwork ?? 'episode');
  const cwRemainingFormat = String(cwSettingsValues?.continueWatchingRemainingFormat ?? 'time');
  const cwProgressDirection = String(cwSettingsValues?.continueWatchingProgressDirection ?? 'remaining');

  if (home.isLoading && !billboard && categories.length === 0) {
    return <LoadingSkeleton />;
  }

  if (!home.isLoading && !billboard && categories.length === 0 && continueWatching.length === 0) {
    return <EmptyHome />;
  }

  if (viewAllCategory) {
    return (
      <CategoryGridScreen
        title={viewAllCategory.title}
        items={viewAllCategory.items}
        isLoading={folderLoading}
        posterPrefs={posterPrefs}
        onNavigateDetail={onNavigateDetail}
        onBack={() => setViewAllCategory(null)}
        onDispatch={onDispatch}
      />
    );
  }

  return (
    <div ref={scrollRef} style={styles.screen}>
      {billboard && showHero && (
        <HeroSection
          meta={billboard}
          slides={heroSlides}
          preferSeasonPosters={prefBool(prefs, 'homeSeasonPostersOnHero', true)}
          onPlay={onPlay}
          onDetails={onNavigateDetail}
          onAddToWatchlist={handleAddToWatchlist}
          isActive={isActive}
        />
      )}

      <div style={styles.shelves}>
        {showContinueWatching && continueWatching.length > 0 && (
          <ContinueWatchingRow
            items={continueWatching}
            cwLayout={cwLayout}
            artworkPreference={cwArtwork}
            remainingFormat={cwRemainingFormat}
            progressDirection={cwProgressDirection}
            onItemClick={onResume}
            onDispatch={onDispatch}
          />
        )}
        {categories.map((cat) =>
          cat.type === 'collection' ? (
            <CollectionShelfRow
              key={cat.id}
              title={cat.name}
              folders={cat.items}
              onFolderClick={handleFolderTileClick}
              addonIcon={cat.addonName ? addonIconByName.get(cat.addonName) : undefined}
              gifAutoplayEnabled={gifAutoplayEnabled}
            />
          ) : (
            <ShelfRow
              key={cat.id}
              title={formatCatalogTitle(cat.name, cat.type)}
              items={cat.items}
              onItemClick={onNavigateDetail}
              onViewAll={handleViewAll}
              isLoading={cat.items.length === 0 && !!home.isLoading}
              posterPrefs={posterPrefs}
              topTenEnabled={topTenFeedKeys.has(cat.id)}
              addonIcon={cat.addonName ? addonIconByName.get(cat.addonName) : undefined}
            />
          )
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.state.home === next.state.home &&
  prev.state.settings === next.state.settings &&
  prev.state.addons === next.state.addons &&
  prev.onDispatch === next.onDispatch &&
  prev.onNavigateDetail === next.onNavigateDetail &&
  prev.onPlay === next.onPlay &&
  prev.onResume === next.onResume &&
  prev.isActive === next.isActive,
);

function formatCatalogTitle(name: string, type: string): string {
  let label: string;
  if (type === 'movie') label = t('auto.movies');
  else if (type === 'series') label = t('auto.series');
  else if (type) label = type.charAt(0).toUpperCase() + type.slice(1);
  else return name;
  return `${name} - ${label}`;
}

function buildHeroSlides(billboard: Meta | null, items: Meta[]): Meta[] {
  const seen = new Set<string>();
  return [billboard, ...items]
    .filter((item): item is Meta => !!item && !!(item.background || item.poster))
    .filter((item) => {
      const key = item.id || item.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function LoadingSkeleton() {
  const box: React.CSSProperties = { background: '#12161D', borderRadius: 10, animation: 'pulse 1.6s ease-in-out infinite' };
  return (
    <div style={{ width: '100%', height: '100%', background: '#040508', overflow: 'hidden' }}>
      <div style={{ ...box, width: '100%', height: HOME_HERO_HEIGHT, borderRadius: 0 }} />
      {[0, 1].map((row) => (
        <div key={row} style={{ padding: '28px 58px 0' }}>
          <div style={{ ...box, width: 180, height: 18, marginBottom: 16, animationDelay: `${row * 0.2}s` }} />
          <div style={{ display: 'flex', gap: 18, overflow: 'hidden' }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ ...box, width: 150, height: 225, flexShrink: 0, animationDelay: `${(row * 8 + i) * 0.06}s` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyHome() {
  return (
    <div style={styles.empty}>
      <p style={styles.emptyTitle}>{t('home.welcome')}</p>
      <p style={styles.emptyText}>
        {t('home.install_addon_start')}
        <br />
        {t('home.go_to_addons')}
      </p>
    </div>
  );
}

const HOME_HERO_HEIGHT = 'clamp(600px, 65vh, 860px)';

const styles: Record<string, React.CSSProperties> = {
  screen: {
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    background: '#040508',
    scrollbarWidth: 'none',
    ['--hero-height' as string]: HOME_HERO_HEIGHT,
  },
  shelves: {
    paddingTop: 8,
    paddingBottom: 80,
    background: '#040508',
  },
  empty: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    background: '#040508',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 800,
    margin: 0,
  },
  emptyText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 1.6,
    margin: 0,
  },
};
