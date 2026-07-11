import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { posterPrefsFromState, type PosterPrefs } from '../core/posterPrefs';
import type { AppState, Meta } from '../core/types';
import { getLanguage, t } from '../i18n';
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

const SCROLL_HOVER_IDLE_MS = 180;

const discoverResultsCache = new Map<string, Meta[]>();

interface DiscoverCatalog {
  key: string;
  label: string;
  type: string;
  transportUrl?: string;
  id?: string;
  extras?: Array<{
    name: string;
    options: string[];
    isRequired?: boolean;
  }>;
}

function cacheKey(catalogKey: string | null, extraName: string | null, extraValue: string | null): string {
  return `${catalogKey ?? ''}|${extraName ?? ''}|${extraValue ?? ''}`;
}

function isSearchOnlyCatalog(cat: { extra?: Array<{ name?: string; isRequired?: boolean; options?: string[] }> }): boolean {
  const extra = cat.extra ?? [];
  const requiresSearch = extra.some((e) => e.name === 'search' && e.isRequired);
  if (!requiresSearch) return false;
  return !extra.some((e) => e.name !== 'search' && e.name !== 'skip' && (e.options?.length ?? 0) > 0);
}

function DiscoverScreenInner({ state, onDispatch, onNavigateDetail, initialGenre }: Props) {
  const discover = state.discover;
  const [contentType, setContentType] = useState<string>('movie');
  const [selectedCatalogKey, setSelectedCatalogKey] = useState<string | null>(null);
  const [extraValue, setExtraValue] = useState<string | null>(initialGenre ?? null);
  const [hoveredMeta, setHoveredMeta] = useState<Meta | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<Meta | null>(null);
  const isGridScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const hoveredMetaRef = useRef<Meta | null>(null);
  const catalogs = ((discover.catalogs ?? []) as DiscoverCatalog[]).filter((catalog) => catalog.type === contentType);
  const selectedCatalog = catalogs.find((catalog) => catalog.key === selectedCatalogKey) ?? null;
  const selectedExtra = selectedCatalog?.extras?.[0] ?? null;
  const key = cacheKey(selectedCatalog?.key ?? null, selectedExtra?.name ?? null, extraValue);
  const cachedResults = discoverResultsCache.get(key) ?? null;
  const lastDispatchedKeyRef = useRef<string | null>(null);
  const posterPrefs = useMemo(() => posterPrefsFromState(state), [state.settings?.values]);

  const panelMeta = hoveredMeta ?? selectedMeta;

  useEffect(() => {
    setSelectedCatalogKey(null);
    setExtraValue(initialGenre ?? null);
    onDispatch(JSON.stringify({ type: 'discoverCatalogFiltersRequested', contentType, language: getLanguage() }));
  }, [contentType]);

  useEffect(() => {
    if (!selectedCatalogKey && catalogs.length > 0) setSelectedCatalogKey(catalogs[0].key);
  }, [catalogs, selectedCatalogKey]);

  useEffect(() => {
    if (!selectedCatalog) return;
    if (extraValue && !selectedExtra?.options.includes(extraValue)) setExtraValue(null);
  }, [selectedCatalog, selectedExtra, extraValue]);

  useEffect(() => {
    if (!selectedCatalog || discoverResultsCache.has(key)) return;
    const timer = window.setTimeout(() => {
      lastDispatchedKeyRef.current = key;
      onDispatch(JSON.stringify({
        type: 'discoverRequested',
        contentType,
        filters: {
          catalogKey: selectedCatalog.key,
          extra: selectedExtra && extraValue ? { [selectedExtra.name]: extraValue } : {},
        },
        language: getLanguage(),
      }));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [contentType, selectedCatalog, selectedExtra, extraValue, key]);

  const results = useMemo(() => (discover.results ?? []) as Meta[], [discover.results]);
  const resultsMatchCurrentKey = lastDispatchedKeyRef.current === key;
  if (results.length > 0 && resultsMatchCurrentKey) {
    discoverResultsCache.set(key, results);
  }

  const isFinal = !discover.isLoading && resultsMatchCurrentKey && results.length > 0;
  const baseResults = isFinal ? results : (cachedResults ?? []);
  const isWaitingForResults = !!selectedCatalog && !cachedResults && !resultsMatchCurrentKey;
  const isLoading = discover.isLoading || discover.catalogsLoading || isWaitingForResults;

  const [pagingExtra, setPagingExtra] = useState<Record<string, Meta[]>>({});
  const pagingNoMoreRef = useRef<Set<string>>(new Set());
  const pendingPagingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    pendingPagingKeyRef.current = null;
  }, [key]);

  const displayResults = useMemo(() => {
    const seen = new Set<string>();
    const merged: Meta[] = [];
    for (const item of [...baseResults, ...(pagingExtra[key] ?? [])]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
    return merged;
  }, [baseResults, pagingExtra, key]);

  const handleLoadMore = useCallback(() => {
    if (!selectedCatalog?.transportUrl || !selectedCatalog.id) return;
    if (isLoading || pagingNoMoreRef.current.has(key) || pendingPagingKeyRef.current) return;
    pendingPagingKeyRef.current = key;
    onDispatch(JSON.stringify({
      type: 'discoverPageRequested',
      transportUrl: selectedCatalog.transportUrl,
      contentType: selectedCatalog.type,
      catalogId: selectedCatalog.id,
      skip: displayResults.length,
      genre: extraValue,
    }));
  }, [selectedCatalog, key, extraValue, displayResults.length, isLoading, onDispatch]);

  useEffect(() => {
    const paging = discover.paging;
    const pendingKey = pendingPagingKeyRef.current;
    if (!paging || !pendingKey || paging.isLoading) return;
    pendingPagingKeyRef.current = null;
    const items = Array.isArray(paging.items) ? paging.items : [];
    if (paging.error || items.length === 0) {
      pagingNoMoreRef.current.add(pendingKey);
      return;
    }
    setPagingExtra((prev) => {
      const existing = prev[pendingKey] ?? [];
      const knownIds = new Set([...baseResults.map((m) => m.id), ...existing.map((m) => m.id)]);
      const newItems = items.filter((item) => !knownIds.has(item.id));
      if (newItems.length === 0) {
        pagingNoMoreRef.current.add(pendingKey);
        return prev;
      }
      return { ...prev, [pendingKey]: [...existing, ...newItems] };
    });
  }, [discover.paging, baseResults]);

  const typeOptions = useMemo(() => {
    const types = ['movie', 'series'];
    for (const addon of state.addons?.installed ?? []) {
      for (const cat of addon.manifest?.catalogs ?? addon.catalogs ?? []) {
        if (!cat.type || types.includes(cat.type) || isSearchOnlyCatalog(cat)) continue;
        types.push(cat.type);
      }
    }
    return types.map((ty) => ({
      value: ty,
      label: ty === 'movie' ? t('auto.movies') : ty === 'series' ? t('auto.series') : ty.charAt(0).toUpperCase() + ty.slice(1),
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
            onSelect={setContentType}
          />
          <FilterDropdown
            value={selectedCatalog?.label ?? t('discover.catalog')}
            options={catalogs.map((catalog) => ({ value: catalog.key, label: catalog.label }))}
            onSelect={(v) => { setSelectedCatalogKey(v); setExtraValue(null); }}
          />
          {selectedExtra && (
            <FilterDropdown
              value={extraValue ?? selectedExtra.name}
              options={[
                { value: '__all__', label: t('discover.all_filter_values', selectedExtra.name) },
                ...selectedExtra.options.map((option) => ({ value: option, label: option })),
              ]}
              onSelect={(v) => setExtraValue(v === '__all__' ? null : v)}
            />
          )}
          {isLoading && <div style={S.loadingDot} />}
        </div>

        {isLoading && displayResults.length === 0 ? (
          <div style={S.loadingGrid}>
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} style={{ borderRadius: '0.625rem', background: '#1B212B', aspectRatio: '2/3', animation: 'pulse 1.6s ease-in-out infinite', animationDelay: `${(i % 8) * 0.07}s` }} />
            ))}
          </div>
        ) : displayResults.length === 0 ? (
          <div style={S.empty}>
            <p style={S.emptyTitle}>{t('discover.no_content')}</p>
            <p style={S.emptyHint}>{t('discover.install_addons_hint')}</p>
          </div>
        ) : (
          <VirtualizedPosterGrid
            resetKey={key}
            items={displayResults}
            selectedId={panelMeta?.id ?? null}
            posterPrefs={posterPrefs}
            onHover={handlePosterHover}
            onClick={handlePosterClick}
            onScrollActivity={handleGridScroll}
            onNearEnd={handleLoadMore}
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
  screen: { display: 'flex', width: 'calc(100% - 6.5rem)', height: 'calc(100% - 3.25rem)', marginLeft: '6.5rem', marginTop: '3.25rem', background: '#09091280', overflow: 'hidden' },
  left: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  filterBar: { display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.625rem 1.5rem', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  loadingDot: { marginLeft: 'auto', width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 },
  loadingGrid: { flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(9.375rem, 1fr))', gap: '1.75rem 1.125rem', padding: '1.25rem 1.5rem 3.75rem', alignContent: 'start', scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent', contain: 'layout paint style' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.625rem' },
  emptyTitle: { color: '#FFFFFF', fontSize: '1.25rem', fontWeight: 700, margin: 0 },
  emptyHint: { color: 'rgba(255,255,255,0.4)', fontSize: '0.875rem', margin: 0, textAlign: 'center' },
  right: { width: '18.75rem', flexShrink: 0, background: '#0C0D18', borderLeft: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto', scrollbarWidth: 'none', display: 'flex', flexDirection: 'column' },
  panelEmpty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1.5rem' },
  panelEmptyText: { color: 'rgba(255,255,255,0.28)', fontSize: '0.8125rem', textAlign: 'center', margin: 0 },
};

export const DiscoverScreen = memo(DiscoverScreenInner, (prev, next) =>
  prev.state.discover === next.state.discover
  && prev.state.settings === next.state.settings
  && prev.state.addons === next.state.addons
  && prev.onDispatch === next.onDispatch
  && prev.onNavigateDetail === next.onNavigateDetail
  && prev.initialGenre === next.initialGenre,
);
