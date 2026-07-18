import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { MovieCard } from '../components/MovieCard';
import { appPrefs, prefBool } from '../core/appPrefs';
import { posterPrefsFromState, type PosterPrefs } from '../core/posterPrefs';
import { addRecentSearch, clearRecentSearches, loadRecentSearches, removeRecentSearch, type RecentSearch } from '../core/searchHistory';
import type { AppState, HomeCategory, Meta } from '../core/types';
import { getLanguage, t } from '../i18n';
import { coreInvoke } from '../core/engine';

interface Props {
  state: AppState;
  onDispatch: (actionJson: string) => void;
  onNavigateDetail: (meta: Meta) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
}

const TYPE_FILTERS = [
  { labelKey: 'auto.all', value: '' },
  { labelKey: 'auto.movies', value: 'movie' },
  { labelKey: 'auto.series', value: 'series' },
];

const GENRE_CHIPS = [
  'genre.action', 'genre.thriller', 'genre.scifi', 'genre.comedy', 'genre.drama',
  'genre.horror', 'genre.animation', 'genre.documentary', 'genre.romance', 'genre.crime',
];

const NAV_RAIL_WIDTH = 6.5;

const searchResultsCache = new Map<string, HomeCategory[]>();

export const SearchScreen = React.memo(function SearchScreen({ state, onDispatch, onNavigateDetail, query, onQueryChange, onBack }: Props) {
  const [typeFilter, setTypeFilter] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const search = state.search;
  const posterPrefs = posterPrefsFromState(state, 0.85);
  const trimmedQuery = query.trim();
  const lastRecentQueryRef = useRef('');
  const [screenPlan, setScreenPlan] = useState<{
    query: string;
    queryEligible: boolean;
    shouldDispatch: boolean;
    shouldCache: boolean;
    categories: HomeCategory[];
    resultCount: number;
    categoryCount: number;
    isLoading: boolean;
  }>({ query: '', queryEligible: false, shouldDispatch: false, shouldCache: false, categories: [], resultCount: 0, categoryCount: 0, isLoading: false });

  useEffect(() => {
    loadRecentSearches().then(setRecentSearches);
  }, []);

  const cachedCategories = searchResultsCache.get(trimmedQuery) ?? null;
  useEffect(() => {
    let active = true;
    void coreInvoke<typeof screenPlan>('searchScreenPlan', JSON.stringify({
      query,
      searchQuery: search.query,
      searchCategories: search.categories ?? [],
      cachedCategories: cachedCategories ?? [],
      hasCache: cachedCategories != null,
      searchLoading: search.isLoading,
      typeFilter,
    })).then((plan) => {
      if (!active || !plan) return;
      if (plan.shouldCache) searchResultsCache.set(plan.query, search.categories as HomeCategory[]);
      setScreenPlan(plan);
    });
    return () => { active = false; };
  }, [query, search.query, search.categories, search.isLoading, cachedCategories, typeFilter]);

  useEffect(() => {
    if (!screenPlan.queryEligible || screenPlan.query !== trimmedQuery) return;
    if (lastRecentQueryRef.current !== screenPlan.query) {
      lastRecentQueryRef.current = screenPlan.query;
      void addRecentSearch(screenPlan.query, recentSearches).then(setRecentSearches);
    }
    if (screenPlan.shouldDispatch) onDispatch(JSON.stringify({ type: 'searchRequested', query: screenPlan.query, language: getLanguage() }));
  }, [screenPlan.query, screenPlan.queryEligible, screenPlan.shouldDispatch, trimmedQuery, onDispatch]);

  const categories = screenPlan.categories;
  const resultCount = screenPlan.resultCount;
  const isLoading = screenPlan.isLoading;

  const handleGenreClick = (genreKey: string) => {
    onQueryChange(t(genreKey));
  };

  const handleRecentClick = (recent: RecentSearch) => {
    const openDetail = prefBool(appPrefs(state), 'searchSuggestionsOpenDetail', false);
    if (openDetail && recent.meta) {
      onNavigateDetail(recent.meta);
      return;
    }
    onQueryChange(recent.query);
  };

  const handleRemoveRecent = (value: string) => {
    void removeRecentSearch(value, recentSearches).then(setRecentSearches);
  };

  const handleClearRecent = () => {
    void clearRecentSearches().then(setRecentSearches);
  };

  return (
    <div style={styles.screen}>
      <div style={styles.content}>
        <button style={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={18} strokeWidth={2.2} />
          {t('auto.back')}
        </button>

        <div style={styles.header}>
          <p style={styles.eyebrow}>{t('auto.search_results')}</p>
          <h1 style={styles.title}>{query.trim() ? query.trim() : t('auto.search')}</h1>
          {query.trim().length >= 2 && !isLoading && (
            <p style={styles.subtitle}>{t('search.results_across_catalogs', resultCount, screenPlan.categoryCount)}</p>
          )}
        </div>

        <div style={styles.typeRow}>
          {TYPE_FILTERS.map((f) => (
            <TypeChip
              key={f.value}
              label={t(f.labelKey)}
              selected={typeFilter === f.value}
              onClick={() => setTypeFilter(f.value)}
            />
          ))}
        </div>

        {!query && recentSearches.length > 0 && (
          <>
            <div style={styles.sectionHeaderRow}>
              <p style={styles.sectionLabel}>{t('search.recent_searches')}</p>
              <button style={styles.clearRecentBtn} onClick={handleClearRecent}>{t('common.clear')}</button>
            </div>
            <div style={styles.recentGrid}>
              {recentSearches.map((item) => (
                <RecentSearchChip
                  key={item.query}
                  value={item.query}
                  onClick={() => handleRecentClick(item)}
                  onRemove={() => handleRemoveRecent(item.query)}
                />
              ))}
            </div>
          </>
        )}

        {!query && (
          <>
            <p style={styles.sectionLabel}>{t('search.browse_by_genre')}</p>
            <div style={styles.genreGrid}>
              {GENRE_CHIPS.map((g) => (
                <GenreCard key={g} genre={t(g)} onClick={() => handleGenreClick(g)} />
              ))}
            </div>
          </>
        )}

        {isLoading && (
          <LoadingShelves />
        )}

        {!isLoading && search.error && query.trim().length >= 2 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>{t('common.error')}</p>
            <p style={styles.emptyHint}>{search.error}</p>
            <button
              style={styles.retryBtn}
              onClick={() => {
                searchResultsCache.delete(trimmedQuery);
                onDispatch(JSON.stringify({ type: 'searchRequested', query: trimmedQuery, language: getLanguage() }));
              }}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {!isLoading && !search.error && query.length >= 2 && resultCount === 0 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>{t('format.no_results_for', query)}</p>
            <p style={styles.emptyHint}>{t('search.try_shorter_or_genre')}</p>
            <div style={{ ...styles.genreGrid, marginTop: '1.5rem' }}>
              {GENRE_CHIPS.slice(0, 6).map((g) => (
                <GenreCard key={g} genre={t(g)} onClick={() => handleGenreClick(g)} />
              ))}
            </div>
          </div>
        )}

        {!isLoading && !search.error && categories.length > 0 && (
          <div style={styles.categoryList}>
            {categories.map((category) => (
              <SearchCategoryRow
                key={category.id}
                title={formatCatalogTitle(category.name, category.type)}
                items={category.items}
                onItemClick={onNavigateDetail}
                onDispatch={onDispatch}
                posterPrefs={posterPrefs}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) =>
  prev.state.search === next.state.search &&
  prev.state.settings === next.state.settings &&
  prev.query === next.query &&
  prev.onDispatch === next.onDispatch &&
  prev.onNavigateDetail === next.onNavigateDetail &&
  prev.onQueryChange === next.onQueryChange &&
  prev.onBack === next.onBack,
);

function LoadingShelves() {
  return (
    <div style={styles.categoryList}>
      {Array.from({ length: 3 }).map((_, row) => (
        <div key={row} style={styles.category}>
          <div style={{ ...styles.skeletonTitle, width: 220 - row * 24 }} />
          <div style={styles.categoryScroll}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} style={{ ...styles.skeletonCard, animationDelay: `${(row * 7 + i) * 0.04}s` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SearchCategoryRow({
  title,
  items,
  onItemClick,
  onDispatch,
  posterPrefs,
}: {
  title: string;
  items: Meta[];
  onItemClick: (meta: Meta) => void;
  onDispatch: (actionJson: string) => void;
  posterPrefs: PosterPrefs;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, [checkScroll, items.length]);

  return (
    <div
      style={styles.category}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p style={styles.categoryTitle}>{title}</p>
      <div style={{ position: 'relative' }}>
        {hovered && canScrollLeft && (
          <SearchScrollArrow
            direction="left"
            onClick={() => scrollRef.current?.scrollBy({ left: -520, behavior: 'smooth' })}
          />
        )}
        <div ref={scrollRef} style={styles.categoryScroll}>
          {items.map((meta) => (
            <MovieCard
              key={`${title}:${meta.id}`}
              meta={meta}
              width={posterPrefs.width}
              height={posterPrefs.height}
              radius={posterPrefs.radius}
              layout={posterPrefs.layout}
              hideTitle={posterPrefs.hideTitles}
              onClick={onItemClick}
              onDispatch={onDispatch}
            />
          ))}
        </div>
        {hovered && canScrollRight && (
          <SearchScrollArrow
            direction="right"
            onClick={() => scrollRef.current?.scrollBy({ left: 520, behavior: 'smooth' })}
          />
        )}
      </div>
    </div>
  );
}

function SearchScrollArrow({ direction, onClick }: { direction: 'left' | 'right'; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const isLeft = direction === 'left';
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [direction]: 0,
        width: '5.625rem',
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isLeft ? 'flex-start' : 'flex-end',
        background: isLeft
          ? 'linear-gradient(to right, rgba(4,5,8,0.9) 30%, transparent 100%)'
          : 'linear-gradient(to left, rgba(4,5,8,0.9) 30%, transparent 100%)',
        pointerEvents: 'none',
      }}
    >
      <button
        style={{
          width: '2.375rem',
          height: '2.375rem',
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.16)',
          background: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(14,15,22,0.9)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'auto',
          margin: isLeft ? '0 0 0 0.625rem' : '0 0.625rem 0 0',
          transition: 'background 0.15s',
          flexShrink: 0,
          boxShadow: '0 0.125rem 0.75rem rgba(0,0,0,0.5)',
          padding: 0,
        }}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isLeft ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </div>
  );
}

function RecentSearchChip({ value, onClick, onRemove }: { value: string; onClick: () => void; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        ...styles.recentChip,
        background: hovered ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.045)',
        borderColor: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button style={styles.recentChipMain} onClick={onClick}>
        <Clock size={15} color="rgba(255,255,255,0.45)" />
        <span style={styles.recentChipText}>{value}</span>
      </button>
      <button
        title={t('common.remove')}
        style={styles.recentChipRemove}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function formatCatalogTitle(name: string, type: string): string {
  let label: string;
  if (type === 'movie') label = t('auto.movies');
  else if (type === 'series') label = t('auto.series');
  else if (type) label = type.charAt(0).toUpperCase() + type.slice(1);
  else return name;
  return `${name} - ${label}`;
}



function TypeChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        height: '2.125rem',
        padding: '0 1rem',
        borderRadius: '62.4375rem',
        border: selected ? 'none' : '1px solid rgba(255,255,255,0.12)',
        background: selected ? '#FFFFFF' : hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: selected ? '#000000' : '#FFFFFF',
        fontSize: '0.8125rem',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
        flexShrink: 0,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
    </button>
  );
}

function GenreCard({ genre, onClick }: { genre: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        height: '4rem',
        borderRadius: '0.75rem',
        border: '1px solid rgba(255,255,255,0.08)',
        background: hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
        color: '#FFFFFF',
        fontSize: '0.875rem',
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'background 0.15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: hovered ? '0 0 0 0.0938rem rgba(255,255,255,0.3)' : 'none',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {genre}
    </button>
  );
}

function SearchResultRow({ meta, onClick }: { meta: Meta; onClick: (meta: Meta) => void }) {
  const [hovered, setHovered] = useState(false);
  const [imgErr, setImgErr] = useState(false);

  const metaChips: string[] = [];
  if (meta.releaseInfo) metaChips.push(meta.releaseInfo);
  metaChips.push(meta.type === 'movie' ? t('auto.movie') : t('auto.series'));
  if (meta.genres?.[0]) metaChips.push(meta.genres[0]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '0.625rem 0.75rem',
        borderRadius: '0.75rem',
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.05)',
        transition: 'background 0.15s',
      }}
      onClick={() => onClick(meta)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Poster */}
      <div style={{ width: '3.375rem', height: '4.875rem', borderRadius: '0.5rem', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }}>
        {meta.poster && !imgErr ? (
          <img
            src={meta.poster}
            alt={meta.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '1rem', fontWeight: 900 }}>
              {(meta.name ?? '').slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: '#FFFFFF', fontSize: '0.9375rem', fontWeight: 700, margin: '0 0 0.3125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta.name}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8125rem', fontWeight: 600, margin: 0 }}>
          {metaChips.join('  ·  ')}
        </p>
      </div>

      <ChevronRight size={18} style={{ flexShrink: 0, color: 'rgba(255,255,255,0.2)' }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#040508',
    overflow: 'hidden',
  },
  topBar: {
    padding: '1.5rem 2rem 1rem',
    flexShrink: 0,
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    height: '3.25rem',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.875rem',
    padding: '0 1rem',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#FFFFFF',
    fontSize: '1rem',
    fontWeight: 600,
  },
  clearBtn: {
    width: '1.75rem',
    height: '1.75rem',
    background: 'transparent',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    padding: 0,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: `2.125rem 2.25rem 2.75rem ${NAV_RAIL_WIDTH + 2.625}rem`,
    scrollbarWidth: 'none',
  },
  header: {
    marginBottom: '1.375rem',
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4375rem',
    height: '2.125rem',
    padding: '0 0.75rem',
    borderRadius: '62.4375rem',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.76)',
    fontSize: '0.75rem',
    fontWeight: 750,
    marginBottom: '1.125rem',
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: '0.75rem',
    fontWeight: 800,
    margin: '0 0 0.375rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05rem',
  },
  title: {
    color: '#FFFFFF',
    fontSize: '2.125rem',
    lineHeight: '2.4375rem',
    fontWeight: 900,
    margin: 0,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: '0.8125rem',
    fontWeight: 600,
    margin: '0.5rem 0 0',
  },
  typeRow: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.75rem',
    flexWrap: 'wrap',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: '0.8125rem',
    fontWeight: 700,
    margin: '0 0 0.875rem',
    textTransform: 'uppercase',
    letterSpacing: '0.0313rem',
  },
  sectionHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    marginBottom: '0.875rem',
  },
  clearRecentBtn: {
    height: '1.75rem',
    padding: '0 0.625rem',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.58)',
    borderRadius: '62.4375rem',
    fontSize: '0.75rem',
    fontWeight: 700,
    cursor: 'pointer',
  },
  recentGrid: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.625rem',
    marginBottom: '2rem',
  },
  recentChip: {
    height: '2.375rem',
    display: 'flex',
    alignItems: 'center',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '62.4375rem',
    transition: 'background 0.15s, border-color 0.15s',
    maxWidth: '17.5rem',
  },
  recentChipMain: {
    minWidth: 0,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0 0.5rem 0 0.8125rem',
    background: 'transparent',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
  },
  recentChipText: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.8125rem',
    fontWeight: 700,
  },
  recentChipRemove: {
    width: '1.875rem',
    height: '1.875rem',
    marginRight: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '50%',
    background: 'transparent',
    color: 'rgba(255,255,255,0.42)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  genreGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(8.75rem, 1fr))',
    gap: '0.625rem',
    marginBottom: '2rem',
  },
  resultList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  categoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    paddingBottom: '2.25rem',
  },
  category: {
    paddingTop: '0.75rem',
  },
  categoryTitle: {
    color: '#FFFFFF',
    fontSize: '1.25rem',
    fontWeight: 800,
    margin: '0 0 0.75rem',
  },
  categoryScroll: {
    display: 'flex',
    gap: '0.875rem',
    overflowX: 'auto',
    overflowY: 'visible',
    padding: '0.5rem 2.25rem 1.75rem 0',
    scrollbarWidth: 'none',
  },
  skeletonTitle: {
    height: '1.25rem',
    borderRadius: '0.375rem',
    background: 'rgba(255,255,255,0.05)',
    marginBottom: '0.875rem',
    animation: 'pulse 1.6s ease-in-out infinite',
  },
  skeletonCard: {
    width: '8.25rem',
    height: '12.375rem',
    borderRadius: '0.75rem',
    background: 'rgba(255,255,255,0.045)',
    flexShrink: 0,
    animation: 'pulse 1.6s ease-in-out infinite',
  },
  emptyState: {
    paddingTop: '2.5rem',
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: '1.125rem',
    fontWeight: 700,
    margin: '0 0 0.375rem',
  },
  emptyHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '0.875rem',
    margin: 0,
  },
  retryBtn: {
    height: '2.25rem',
    marginTop: '1rem',
    padding: '0 0.875rem',
    borderRadius: '62.4375rem',
    border: '1px solid rgba(255,255,255,0.14)',
    background: '#FFFFFF',
    color: '#000000',
    fontSize: '0.8125rem',
    fontWeight: 800,
    cursor: 'pointer',
  },
};
