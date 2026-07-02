import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { posterPrefsFromState, type PosterPrefs } from '../core/posterPrefs';
import type { AppState, Meta } from '../core/types';
import { getLanguage, t } from '../i18n';
import { setDiscoverPartialHandler } from '../core/catalogEffects';
import { FilterDropdown } from '../components/FilterDropdown';
import { DiscoverDetailPanel } from '../components/DiscoverDetailPanel';
import { VirtualizedPosterGrid } from '../components/VirtualizedPosterGrid';

interface Props {
  state: AppState;
  onDispatch: (actionJson: string) => void;
  onNavigateDetail: (meta: Meta) => void;
  onBack: () => void;
  initialGenre?: string | null;
}

const SORT_OPTIONS = [
  { value: 'popular', labelKey: 'metadata.popular' },
  { value: 'top', labelKey: 'auto.top_rated' },
  { value: 'newest', labelKey: 'sort.release_date_desc' },
];

const FALLBACK_GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Fantasy', 'Horror', 'Mystery',
  'Romance', 'Sci-Fi', 'Thriller',
];

const SCROLL_HOVER_IDLE_MS = 180;

const YEAR_BUCKETS = [
  { value: '2020s', min: 2020, max: 9999 },
  { value: '2010s', min: 2010, max: 2019 },
  { value: '2000s', min: 2000, max: 2009 },
  { value: '1990s', min: 1990, max: 1999 },
  { value: '1980s', min: 1980, max: 1989 },
  { value: 'older', min: 0, max: 1979 },
];

const RATING_OPTIONS = [9, 8, 7, 6];

function itemYear(m: Meta): number | null {
  const y = parseInt(String(m.releaseInfo ?? '').slice(0, 4), 10);
  return Number.isFinite(y) && y > 1800 ? y : null;
}

let lastDiscoverFetch: { contentType: string; sortBy: string; genre: string | null } | null = null;
const discoverResultsCache = new Map<string, Meta[]>();

function cacheKey(contentType: string, sortBy: string, genre: string | null): string {
  return `${contentType}|${sortBy}|${genre ?? ''}`;
}

export function warmDiscoverCache(contentType: string, sortBy: string, genre: string | null) {
  lastDiscoverFetch = { contentType, sortBy, genre };
}

function DiscoverScreenInner({ state, onDispatch, onNavigateDetail, initialGenre }: Props) {
  const discover = state.discover;
  const [contentType, setContentType] = useState<string>('movie');
  const [sortBy, setSortBy] = useState<string>('popular');
  const [genre, setGenre] = useState<string | null>(initialGenre ?? null);
  const [yearBucket, setYearBucket] = useState<string | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [hoveredMeta, setHoveredMeta] = useState<Meta | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<Meta | null>(null);
  const isGridScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const hoveredMetaRef = useRef<Meta | null>(null);
  const key = cacheKey(contentType, sortBy, genre);
  const cachedResults = discoverResultsCache.get(key) ?? null;
  const staleResultsRef = useRef<Meta[]>(cachedResults ?? []);
  const [streamingItems, setStreamingItems] = useState<Meta[]>([]);
  const streamingAccRef = useRef<Meta[]>([]);
  const streamingFlushTimerRef = useRef<number | null>(null);
  const posterPrefs = useMemo(() => posterPrefsFromState(state), [state.settings?.values]);

  const panelMeta = hoveredMeta ?? selectedMeta;

  const genreOptions = (discover.filters ?? [])
    .find((f) => f.name.toLowerCase() === 'genre')
    ?.options ?? FALLBACK_GENRES;

  useEffect(() => {
    const cached = discoverResultsCache.get(cacheKey(contentType, sortBy, genre));
    const sameParams = lastDiscoverFetch?.contentType === contentType
      && lastDiscoverFetch?.sortBy === sortBy
      && lastDiscoverFetch?.genre === genre;
    if (cached && sameParams) return;
    lastDiscoverFetch = { contentType, sortBy, genre };
    onDispatch(JSON.stringify({ type: 'discoverRequested', contentType, sortBy, genre, language: getLanguage() }));
  }, [contentType, sortBy, genre]);

  const results = useMemo(() => (discover.results ?? []) as Meta[], [discover.results]);
  if (results.length > 0) {
    staleResultsRef.current = results;
    discoverResultsCache.set(key, results);
  }

  useEffect(() => {
    if (!discover.isLoading) {
      if (streamingFlushTimerRef.current != null) {
        window.clearTimeout(streamingFlushTimerRef.current);
        streamingFlushTimerRef.current = null;
      }
      setStreamingItems([]);
      streamingAccRef.current = [];
      setDiscoverPartialHandler(null);
      return;
    }
    streamingAccRef.current = [];
    setStreamingItems([]);
    setDiscoverPartialHandler((items) => {
      streamingAccRef.current = [...streamingAccRef.current, ...(items as Meta[])];
      // Coalesce bursts of addon responses into one render instead of one per addon.
      if (streamingFlushTimerRef.current != null) return;
      streamingFlushTimerRef.current = window.setTimeout(() => {
        streamingFlushTimerRef.current = null;
        setStreamingItems(streamingAccRef.current);
      }, 150);
    });
    return () => {
      if (streamingFlushTimerRef.current != null) {
        window.clearTimeout(streamingFlushTimerRef.current);
        streamingFlushTimerRef.current = null;
      }
      setDiscoverPartialHandler(null);
    };
  }, [discover.isLoading]);

  const displayResults = discover.isLoading
    ? (streamingItems.length > 0 ? streamingItems : staleResultsRef.current)
    : (results.length > 0 ? results : (cachedResults ?? staleResultsRef.current));

  const filteredResults = useMemo(() => {
    if (!yearBucket && minRating === null) return displayResults;
    const bucket = YEAR_BUCKETS.find((b) => b.value === yearBucket);
    return displayResults.filter((m) => {
      if (bucket) {
        const y = itemYear(m);
        if (y === null || y < bucket.min || y > bucket.max) return false;
      }
      if (minRating !== null) {
        const r = parseFloat(String(m.imdbRating ?? ''));
        if (!Number.isFinite(r) || r < minRating) return false;
      }
      return true;
    });
  }, [displayResults, yearBucket, minRating]);

  const typeOptions = useMemo(() => {
    const types = ['movie', 'series'];
    for (const addon of state.addons?.installed ?? []) {
      for (const cat of addon.manifest?.catalogs ?? addon.catalogs ?? []) {
        if (cat.type && !types.includes(cat.type)) types.push(cat.type);
      }
    }
    return types.map((ty) => ({
      value: ty,
      label: ty === 'movie' ? t('auto.movie') : ty === 'series' ? t('auto.series') : ty.charAt(0).toUpperCase() + ty.slice(1),
    }));
  }, [state.addons?.installed]);

  const handleGridScroll = useCallback(() => {
    isGridScrollingRef.current = true;
    if (hoveredMetaRef.current) {
      hoveredMetaRef.current = null;
      setHoveredMeta(null);
    }
    if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = window.setTimeout(() => {
      isGridScrollingRef.current = false;
      scrollIdleTimerRef.current = null;
    }, SCROLL_HOVER_IDLE_MS);
  }, []);

  useEffect(() => {
    return () => { if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current); };
  }, []);

  const handlePosterHover = useCallback((meta: Meta | null): boolean => {
    if (isGridScrollingRef.current) return false;
    hoveredMetaRef.current = meta;
    setHoveredMeta(meta);
    return true;
  }, []);

  const handlePosterClick = useCallback((meta: Meta) => {
    setSelectedMeta((prev) => {
      if (prev?.id === meta.id) {
        onNavigateDetail(meta);
        return prev;
      }
      return meta;
    });
  }, [onNavigateDetail]);

  return (
    <div style={S.screen}>
      <div style={S.left}>
        <div style={S.filterBar}>
          <FilterDropdown
            value={typeOptions.find((o) => o.value === contentType)?.label ?? contentType}
            options={typeOptions}
            onSelect={(v) => { setContentType(v); setGenre(null); }}
          />
          <FilterDropdown
            value={t(SORT_OPTIONS.find((s) => s.value === sortBy)?.labelKey ?? 'metadata.popular')}
            options={SORT_OPTIONS.map((s) => ({ value: s.value, label: t(s.labelKey) }))}
            onSelect={(v) => setSortBy(v)}
          />
          <FilterDropdown
            value={genre ?? t('auto.genre')}
            options={[{ value: '__all__', label: t('search.all_genres') }, ...genreOptions.map((g) => ({ value: g, label: g }))]}
            onSelect={(v) => setGenre(v === '__all__' ? null : v)}
          />
          <FilterDropdown
            value={yearBucket ? (yearBucket === 'older' ? t('discover.older') : yearBucket) : t('discover.year')}
            options={[
              { value: '__all__', label: t('discover.all_years') },
              ...YEAR_BUCKETS.map((b) => ({ value: b.value, label: b.value === 'older' ? t('discover.older') : b.value })),
            ]}
            onSelect={(v) => setYearBucket(v === '__all__' ? null : v)}
          />
          <FilterDropdown
            value={minRating !== null ? `${minRating}+` : t('discover.rating')}
            options={[
              { value: '__all__', label: t('discover.any_rating') },
              ...RATING_OPTIONS.map((r) => ({ value: String(r), label: `${r}+` })),
            ]}
            onSelect={(v) => setMinRating(v === '__all__' ? null : parseInt(v, 10))}
          />
          {discover.isLoading
            ? <div style={S.loadingDot} />
            : filteredResults.length > 0 && <span style={S.resultCount}>{t('discover.result_count', filteredResults.length)}</span>
          }
        </div>

        {discover.isLoading && filteredResults.length === 0 ? (
          <div style={S.loadingGrid}>
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} style={{ borderRadius: 10, background: '#1B212B', aspectRatio: '2/3', animation: 'pulse 1.6s ease-in-out infinite', animationDelay: `${(i % 8) * 0.07}s` }} />
            ))}
          </div>
        ) : filteredResults.length === 0 ? (
          <div style={S.empty}>
            <p style={S.emptyTitle}>{t('discover.no_content')}</p>
            <p style={S.emptyHint}>{t('discover.install_addons_hint')}</p>
          </div>
        ) : (
          <VirtualizedPosterGrid
            items={filteredResults}
            selectedId={panelMeta?.id ?? null}
            posterPrefs={posterPrefs}
            onHover={handlePosterHover}
            onClick={handlePosterClick}
            onScrollActivity={handleGridScroll}
          />
        )}
      </div>

      <div style={S.right}>
        {panelMeta ? (
          <DiscoverDetailPanel meta={panelMeta} onPlay={() => onNavigateDetail(panelMeta)} onDispatch={onDispatch} />
        ) : (
          <div style={S.panelEmpty}>
            <LayoutGrid size={40} style={{ color: 'rgba(255,255,255,0.12)' }} />
            <p style={S.panelEmptyText}>{t('discover.hover_title_hint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  screen: { display: 'flex', width: 'calc(100% - 104px)', height: 'calc(100% - 52px)', marginLeft: 104, marginTop: 52, background: '#09091280', overflow: 'hidden' },
  left: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  filterBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  resultCount: { marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 12, fontWeight: 600, letterSpacing: '0.3px' },
  loadingDot: { marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 },
  loadingGrid: { flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '28px 18px', padding: '20px 24px 60px', alignContent: 'start', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent', contain: 'layout paint style' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: 700, margin: 0 },
  emptyHint: { color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0, textAlign: 'center' },
  right: { width: 300, flexShrink: 0, background: '#0C0D18', borderLeft: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column' },
  panelEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  panelEmptyText: { color: 'rgba(255,255,255,0.28)', fontSize: 13, textAlign: 'center', margin: 0 },
};

export const DiscoverScreen = memo(DiscoverScreenInner, (prev, next) =>
  prev.state.discover === next.state.discover
  && prev.state.settings === next.state.settings
  && prev.state.addons === next.state.addons
  && prev.onDispatch === next.onDispatch
  && prev.onNavigateDetail === next.onNavigateDetail
  && prev.initialGenre === next.initialGenre,
);
