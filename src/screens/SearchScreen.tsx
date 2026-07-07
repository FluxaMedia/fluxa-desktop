import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, X } from 'lucide-react';
import { MovieCard } from '../components/MovieCard';
import { posterPrefsFromState, type PosterPrefs } from '../core/posterPrefs';
import { storageRead, storageWrite } from '../core/engine';
import type { AppState, HomeCategory, Meta } from '../core/types';
import { getLanguage, t } from '../i18n';

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

const NAV_RAIL_WIDTH = 104;
const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT_SEARCHES = 8;

export const SearchScreen = React.memo(function SearchScreen({ state, onDispatch, onNavigateDetail, query, onQueryChange, onBack }: Props) {
  const [typeFilter, setTypeFilter] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const search = state.search;
  const posterPrefs = posterPrefsFromState(state, 0.85);

  useEffect(() => {
    storageRead<string[]>(RECENT_SEARCHES_KEY)
      .then((items) => setRecentSearches(normalizeRecentSearches(items)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length >= 2) {
      rememberRecentSearch(trimmed, setRecentSearches);
      onDispatch(JSON.stringify({ type: 'searchRequested', query: trimmed, language: getLanguage() }));
    }
  }, [query, onDispatch]);

  const handleGenreClick = (genreKey: string) => {
    onQueryChange(t(genreKey));
  };

  const handleRecentClick = (value: string) => {
    onQueryChange(value);
  };

  const handleRemoveRecent = (value: string) => {
    setRecentSearches((current) => {
      const next = current.filter((item) => item !== value);
      void storageWrite(RECENT_SEARCHES_KEY, next);
      return next;
    });
  };

  const handleClearRecent = () => {
    setRecentSearches([]);
    void storageWrite(RECENT_SEARCHES_KEY, []);
  };

  const categories = useMemo(
    () =>
      ((search.categories ?? []) as HomeCategory[])
        .map((category) => ({
          ...category,
          items: typeFilter
            ? category.items.filter((meta) => meta.type === typeFilter)
            : category.items,
        }))
        .filter((category) => category.items.length > 0),
    [search.categories, typeFilter],
  );
  const resultCount = useMemo(
    () => categories.reduce((sum, category) => sum + category.items.length, 0),
    [categories],
  );

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
          {query.trim().length >= 2 && !search.isLoading && (
            <p style={styles.subtitle}>{t('search.results_across_catalogs', resultCount, categories.length)}</p>
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
                  key={item}
                  value={item}
                  onClick={() => handleRecentClick(item)}
                  onRemove={() => handleRemoveRecent(item)}
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

        {search.isLoading && (
          <LoadingShelves />
        )}

        {!search.isLoading && search.error && query.trim().length >= 2 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>{t('common.error')}</p>
            <p style={styles.emptyHint}>{search.error}</p>
            <button
              style={styles.retryBtn}
              onClick={() => onDispatch(JSON.stringify({ type: 'searchRequested', query: query.trim(), language: getLanguage() }))}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {!search.isLoading && !search.error && query.length >= 2 && resultCount === 0 && (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>{t('format.no_results_for', query)}</p>
            <p style={styles.emptyHint}>{t('search.try_shorter_or_genre')}</p>
            <div style={{ ...styles.genreGrid, marginTop: 24 }}>
              {GENRE_CHIPS.slice(0, 6).map((g) => (
                <GenreCard key={g} genre={t(g)} onClick={() => handleGenreClick(g)} />
              ))}
            </div>
          </div>
        )}

        {!search.isLoading && !search.error && categories.length > 0 && (
          <div style={styles.categoryList}>
            {categories.map((category) => (
              <SearchCategoryRow
                key={category.id}
                title={formatCatalogTitle(category.name, category.type)}
                items={category.items}
                onItemClick={onNavigateDetail}
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
  posterPrefs,
}: {
  title: string;
  items: Meta[];
  onItemClick: (meta: Meta) => void;
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
        width: 90,
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
          width: 38,
          height: 38,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.16)',
          background: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(14,15,22,0.9)',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'auto',
          margin: isLeft ? '0 0 0 10px' : '0 10px 0 0',
          transition: 'background 0.15s',
          flexShrink: 0,
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
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

function normalizeRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RECENT_SEARCHES);
}

function rememberRecentSearch(query: string, setRecentSearches: React.Dispatch<React.SetStateAction<string[]>>) {
  const normalized = query.trim();
  if (normalized.length < 2) return;
  setRecentSearches((current) => {
    const next = normalizeRecentSearches([normalized, ...current.filter((item) => item.toLowerCase() !== normalized.toLowerCase())]);
    void storageWrite(RECENT_SEARCHES_KEY, next);
    return next;
  });
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
        height: 34,
        padding: '0 16px',
        borderRadius: 999,
        border: selected ? 'none' : '1px solid rgba(255,255,255,0.12)',
        background: selected ? '#FFFFFF' : hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
        color: selected ? '#000000' : '#FFFFFF',
        fontSize: 13,
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
        height: 64,
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        background: hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        transition: 'background 0.15s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: hovered ? '0 0 0 1.5px rgba(255,255,255,0.3)' : 'none',
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
        gap: 16,
        padding: '10px 12px',
        borderRadius: 12,
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
      <div style={{ width: 54, height: 78, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.05)' }}>
        {meta.poster && !imgErr ? (
          <img
            src={meta.poster}
            alt={meta.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 16, fontWeight: 900 }}>
              {(meta.name ?? '').slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 700, margin: '0 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta.name}
        </p>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: 600, margin: 0 }}>
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
    padding: '24px 32px 16px',
    flexShrink: 0,
  },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    height: 52,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: '0 16px',
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 600,
  },
  clearBtn: {
    width: 28,
    height: 28,
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
    padding: `34px 36px 44px ${NAV_RAIL_WIDTH + 42}px`,
    scrollbarWidth: 'none',
  },
  header: {
    marginBottom: 22,
  },
  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    height: 34,
    padding: '0 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.76)',
    fontSize: 12,
    fontWeight: 750,
    marginBottom: 18,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 12,
    fontWeight: 800,
    margin: '0 0 6px',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: '39px',
    fontWeight: 900,
    margin: 0,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 13,
    fontWeight: 600,
    margin: '8px 0 0',
  },
  typeRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 28,
    flexWrap: 'wrap',
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: 700,
    margin: '0 0 14px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  sectionHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
  },
  clearRecentBtn: {
    height: 28,
    padding: '0 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.58)',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  recentGrid: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 32,
  },
  recentChip: {
    height: 38,
    display: 'flex',
    alignItems: 'center',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 999,
    transition: 'background 0.15s, border-color 0.15s',
    maxWidth: 280,
  },
  recentChipMain: {
    minWidth: 0,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 8px 0 13px',
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
    fontSize: 13,
    fontWeight: 700,
  },
  recentChipRemove: {
    width: 30,
    height: 30,
    marginRight: 4,
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 10,
    marginBottom: 32,
  },
  resultList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  categoryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingBottom: 36,
  },
  category: {
    paddingTop: 12,
  },
  categoryTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 800,
    margin: '0 0 12px',
  },
  categoryScroll: {
    display: 'flex',
    gap: 14,
    overflowX: 'auto',
    overflowY: 'visible',
    padding: '8px 36px 28px 0',
    scrollbarWidth: 'none',
  },
  skeletonTitle: {
    height: 20,
    borderRadius: 6,
    background: 'rgba(255,255,255,0.05)',
    marginBottom: 14,
    animation: 'pulse 1.6s ease-in-out infinite',
  },
  skeletonCard: {
    width: 132,
    height: 198,
    borderRadius: 12,
    background: 'rgba(255,255,255,0.045)',
    flexShrink: 0,
    animation: 'pulse 1.6s ease-in-out infinite',
  },
  emptyState: {
    paddingTop: 40,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 700,
    margin: '0 0 6px',
  },
  emptyHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    margin: 0,
  },
  retryBtn: {
    height: 36,
    marginTop: 16,
    padding: '0 14px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.14)',
    background: '#FFFFFF',
    color: '#000000',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
  },
};
