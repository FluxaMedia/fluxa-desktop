import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  const shelvesScrollRef = React.useRef<HTMLDivElement>(null);
  const [viewAllCategory, setViewAllCategory] = useState<{ title: string; items: Meta[] } | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);

  const handleFolderTileClick = useCallback(async (folderMeta: Meta) => {
    const allCats = (home.categories ?? []) as HomeCategory[];
    const folderCat = allCats.find((c) => c.id === folderMeta.id && c.type === 'collection_folder');
    if (!folderCat?.catalogSources?.length) return;
    setFolderLoading(true);
    try {
      const items = await loadFolderItems(folderCat);
      if (items.length) setViewAllCategory({ title: folderMeta.name, items });
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

  const continueWatching = (home.continueWatching ?? []) as Meta[];
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
  const topTenFeedKeys = useMemo(() => {
    const raw = prefs.topTenFeedToggles;
    return new Set<string>(Array.isArray(raw) ? (raw as string[]) : []);
  }, [prefs.topTenFeedToggles]);

  const handleViewAll = useCallback((title: string, items: Meta[]) => {
    setViewAllCategory({ title, items });
  }, []);

  const handleAddToWatchlist = useCallback(
    (meta: Meta) => onDispatch(JSON.stringify({ type: 'libraryAddRequested', meta })),
    [onDispatch],
  );

  const scrollShelvesFromHero = (event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= 0) return;
    shelvesScrollRef.current?.scrollBy({ top: event.deltaY, left: 0 });
  };

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

  if (folderLoading) {
    return (
      <div style={{ ...styles.screen, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: 600 }}>Loading...</div>
      </div>
    );
  }

  if (viewAllCategory) {
    return (
      <CategoryGridScreen
        title={viewAllCategory.title}
        items={viewAllCategory.items}
        posterPrefs={posterPrefs}
        onNavigateDetail={onNavigateDetail}
        onBack={() => setViewAllCategory(null)}
        onDispatch={onDispatch}
      />
    );
  }

  return (
    <div style={styles.screen}>
      {billboard && showHero && (
        <div style={styles.heroLayer} onWheel={scrollShelvesFromHero}>
          <HeroSection
            meta={billboard}
            slides={heroSlides}
            preferSeasonPosters={prefBool(prefs, 'homeSeasonPostersOnHero', true)}
            onPlay={onPlay}
            onDetails={onNavigateDetail}
            onAddToWatchlist={handleAddToWatchlist}
            isActive={isActive}
          />
        </div>
      )}

      <div ref={shelvesScrollRef} style={styles.shelvesScroll}>
        {billboard && showHero && <div style={styles.heroSpacer} />}

        <div style={styles.shelves}>
          <div style={styles.shelfFade} />
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
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#12161D',
        animation: 'pulse 1.6s ease-in-out infinite',
      }}
    />
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

const styles: Record<string, React.CSSProperties> = {
  screen: {
    position: 'relative',
    background: '#040508',
    height: '100%',
    overflow: 'hidden',
  },
  heroLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  shelvesScroll: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    zIndex: 2,
    scrollbarWidth: 'none',
    pointerEvents: 'none',
    willChange: 'scroll-position',
  },
  heroSpacer: {
    height: 'clamp(600px, 65vh, 860px)',
    pointerEvents: 'none',
  },
  shelves: {
    position: 'relative',
    paddingTop: 16,
    paddingBottom: 80,
    background: 'linear-gradient(to bottom, rgba(4,5,8,0.00) 0px, rgba(4,5,8,0.26) 96px, rgba(4,5,8,0.78) 220px, #040508 390px)',
    pointerEvents: 'auto',
  },
  shelfFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -380,
    height: 860,
    background: 'linear-gradient(to bottom, rgba(4,5,8,0.00) 0%, rgba(4,5,8,0.08) 18%, rgba(4,5,8,0.42) 42%, rgba(4,5,8,0.82) 66%, #040508 90%, #040508 100%)',
    maskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.88) 76%, rgba(0,0,0,0.78) 100%)',
    WebkitMaskImage: 'linear-gradient(to right, black 0%, black 50%, rgba(0,0,0,0.88) 76%, rgba(0,0,0,0.78) 100%)',
    pointerEvents: 'none',
    zIndex: 0,
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

