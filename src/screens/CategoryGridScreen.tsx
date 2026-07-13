import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, LayoutGrid, Play, Plus, TriangleAlert } from 'lucide-react';
import type { Meta, MetaLink } from '../core/types';
import type { PosterPrefs } from '../core/posterPrefs';
import { ModernTabBar } from '../components/detail/DetailButtons';
import { coreInvoke } from '../core/engine';
import { t } from '../i18n';

interface Props {
  title: string;
  items: Meta[];
  groups?: Array<{ type: string; items: Meta[] }>;
  isLoading?: boolean;
  loadError?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  posterPrefs: PosterPrefs;
  onNavigateDetail: (meta: Meta) => void;
  onBack: () => void;
  onDispatch: (a: string) => void;
}

function labelForType(type: string): string {
  if (type === 'movie') return t('auto.movies');
  if (type === 'series') return t('auto.series');
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const GRID_PADDING_X = 24;
const GRID_PADDING_TOP = 20;
const GRID_PADDING_BOTTOM = 60;
const GRID_GAP_X = 18;
const GRID_GAP_Y = 28;
const GRID_MIN_COLUMN_WIDTH = 150;
const GRID_OVERSCAN_ROWS = 3;
const SCROLL_HOVER_IDLE_MS = 180;

export function CategoryGridScreen({ title, items, groups, isLoading = false, loadError = false, onLoadMore, isLoadingMore = false, posterPrefs, onNavigateDetail, onBack, onDispatch }: Props) {
  const [hoveredMeta, setHoveredMeta] = useState<Meta | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<Meta | null>(null);
  const [activeTab, setActiveTab] = useState('all');
  const isGridScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);

  const showTabs = (groups?.length ?? 0) > 1;
  const tabs = useMemo(
    () => [{ id: 'all', label: t('auto.all') }, ...(groups ?? []).map((g) => ({ id: g.type, label: labelForType(g.type) }))],
    [groups],
  );
  const gridItems = useMemo(
    () => (showTabs && activeTab !== 'all' ? groups!.find((g) => g.type === activeTab)?.items ?? [] : items),
    [showTabs, activeTab, groups, items],
  );

  const panelMeta = hoveredMeta ?? selectedMeta;

  useEffect(() => {
    return () => {
      if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
    };
  }, []);

  const handleGridScroll = useCallback(() => {
    isGridScrollingRef.current = true;
    if (hoveredMeta) setHoveredMeta(null);
    if (scrollIdleTimerRef.current != null) window.clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = window.setTimeout(() => {
      isGridScrollingRef.current = false;
      scrollIdleTimerRef.current = null;
    }, SCROLL_HOVER_IDLE_MS);
  }, [hoveredMeta]);

  const handlePosterHover = useCallback((meta: Meta | null): boolean => {
    if (isGridScrollingRef.current) return false;
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
      {/* Left: header + grid */}
      <div style={S.left}>
        <div style={S.header}>
          <button style={S.backBtn} onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
          <h2 style={S.title}>{title}</h2>
          {!isLoading && <span style={S.count}>{gridItems.length} {t('auto.titles')}</span>}
        </div>

        {showTabs && (
          <div style={S.tabBarWrap}>
            <ModernTabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />
          </div>
        )}

        {isLoading && items.length === 0 ? (
          <div style={S.loadingGrid}>
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} style={{ borderRadius: '0.625rem', background: '#1B212B', aspectRatio: '2/3', animation: 'pulse 1.6s ease-in-out infinite', animationDelay: `${(i % 8) * 0.07}s` }} />
            ))}
          </div>
        ) : loadError && items.length === 0 ? (
          <div style={S.gridEmpty}>
            <TriangleAlert size={72} style={{ color: 'rgba(255,255,255,0.35)' }} />
            <p style={S.errorTitle}>{t('home.folder_load_failed')}</p>
            <p style={S.errorBody}>{t('home.folder_load_failed_body')}</p>
          </div>
        ) : (
          <VirtualizedPosterGrid
            items={gridItems}
            selectedId={panelMeta?.id ?? null}
            posterPrefs={posterPrefs}
            onHover={handlePosterHover}
            onClick={handlePosterClick}
            onScrollActivity={handleGridScroll}
            onNearBottom={onLoadMore}
            isLoadingMore={isLoadingMore}
          />
        )}
      </div>

      {/* Right: detail panel */}
      <div style={S.right}>
        {panelMeta ? (
          <DetailPanel meta={panelMeta} onPlay={() => onNavigateDetail(panelMeta)} onDispatch={onDispatch} />
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

function DetailPanel({ meta, onPlay, onDispatch }: { meta: Meta; onPlay: () => void; onDispatch: (a: string) => void }) {
  const [imgErr, setImgErr] = useState(false);
  const bgUrl = !imgErr ? (meta.background ?? meta.poster) : null;

  const [cast, setCast] = useState<string[]>([]);
  const [directors, setDirectors] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    coreInvoke<{ cast: MetaLink[]; directors: MetaLink[] }>('classifyMetaLinks', JSON.stringify(meta.links ?? [])).then((result) => {
      if (cancelled) return;
      setCast((result?.cast ?? []).map((l) => l.name).slice(0, 4));
      setDirectors((result?.directors ?? []).map((l) => l.name).slice(0, 2));
    });
    return () => { cancelled = true; };
  }, [meta.links]);

  return (
    <div style={DP.wrap}>
      {bgUrl && (
        <div style={DP.bg}>
          <img src={bgUrl} alt="" decoding="async" style={DP.bgImg} onError={() => setImgErr(true)} />
          <div style={DP.bgFade} />
        </div>
      )}
      <div style={DP.content}>
        <h1 style={DP.title}>{meta.name}</h1>
        <div style={DP.metaRow}>
          {meta.runtime && <span style={DP.metaItem}>{meta.runtime}</span>}
          {meta.releaseInfo && <span style={DP.metaItem}>{meta.releaseInfo}</span>}
          {meta.imdbRating && (
            <div style={DP.imdbBadge}>
              <span style={DP.imdbLabel}>IMDb</span>
              <span style={DP.imdbVal}>{meta.imdbRating}</span>
            </div>
          )}
        </div>
        {meta.description && <p style={DP.desc}>{meta.description}</p>}
        {Array.isArray(meta.genres) && meta.genres.length > 0 && (
          <div style={DP.section}>
            <p style={DP.sectionLabel}>{t('auto.genres')}</p>
            <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap' }}>
              {meta.genres.slice(0, 5).map((g) => (
                <span key={g} style={DP.genreChip}>{g}</span>
              ))}
            </div>
          </div>
        )}
        {cast.length > 0 && (
          <div style={DP.section}>
            <p style={DP.sectionLabel}>{t('auto.cast')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem 1.25rem' }}>
              {cast.map((name) => <span key={name} style={DP.castName}>{name}</span>)}
            </div>
          </div>
        )}
        {directors.length > 0 && (
          <div style={DP.section}>
            <p style={DP.sectionLabel}>{directors.length > 1 ? t('detail.directors') : t('detail.director')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem 1.25rem' }}>
              {directors.map((name) => <span key={name} style={DP.castName}>{name}</span>)}
            </div>
          </div>
        )}
        <div style={DP.actions}>
          <button style={DP.playBtn} onClick={onPlay}>
            <Play size={15} fill="currentColor" strokeWidth={0} />
            {t('common.details')}
          </button>
          <PanelIconBtn
            title={t('discover.add_to_list')}
            icon={<Plus size={18} />}
            onClick={() => onDispatch(JSON.stringify({ type: 'toggleWatchlistRequested', item: meta }))}
          />
        </div>
      </div>
    </div>
  );
}

function PanelIconBtn({ title, icon, onClick }: { title: string; icon: React.ReactNode; onClick?: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      title={title}
      style={{
        width: '2.375rem', height: '2.375rem', borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.15)',
        background: hovered ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)',
        color: '#FFF', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.15s', flexShrink: 0,
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon}
    </button>
  );
}



function VirtualizedPosterGrid({ items, selectedId, posterPrefs, onHover, onClick, onScrollActivity, onNearBottom, isLoadingMore = false }: {
  items: Meta[];
  selectedId: string | null;
  posterPrefs: PosterPrefs;
  onHover: (m: Meta | null) => boolean;
  onClick: (m: Meta) => void;
  onScrollActivity: () => void;
  onNearBottom?: () => void;
  isLoadingMore?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight, scrollTop: node.scrollTop });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const cardExtraHeight = posterPrefs.hideTitles ? 0 : 23;
  const itemHeight = posterPrefs.height + cardExtraHeight;
  const availableWidth = Math.max(0, viewport.width - GRID_PADDING_X * 2);
  const columns = Math.max(1, Math.floor((availableWidth + GRID_GAP_X) / (GRID_MIN_COLUMN_WIDTH + GRID_GAP_X)));
  const columnWidth = columns > 0
    ? Math.max(GRID_MIN_COLUMN_WIDTH, (availableWidth - GRID_GAP_X * (columns - 1)) / columns)
    : GRID_MIN_COLUMN_WIDTH;
  const rowStep = itemHeight + GRID_GAP_Y;
  const placeholderCount = isLoadingMore ? columns : 0;
  const slotCount = items.length + placeholderCount;
  const rowCount = Math.ceil(slotCount / columns);
  const totalHeight = GRID_PADDING_TOP + GRID_PADDING_BOTTOM + Math.max(0, rowCount * itemHeight + Math.max(0, rowCount - 1) * GRID_GAP_Y);
  const startRow = Math.max(0, Math.floor((viewport.scrollTop - GRID_PADDING_TOP) / rowStep) - GRID_OVERSCAN_ROWS);
  const endRow = Math.min(rowCount, Math.ceil((viewport.scrollTop + viewport.height - GRID_PADDING_TOP) / rowStep) + GRID_OVERSCAN_ROWS);

  useEffect(() => {
    if (!onNearBottom || totalHeight === 0 || viewport.height === 0) return;
    const threshold = rowStep * 2;
    if (viewport.scrollTop + viewport.height >= totalHeight - threshold) onNearBottom();
  }, [viewport.scrollTop, viewport.height, totalHeight, rowStep, onNearBottom]);

  const visible: Array<{ item: Meta; row: number; col: number }> = [];
  const placeholders: Array<{ row: number; col: number }> = [];
  for (let row = startRow; row < endRow; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      const item = items[index];
      if (item) visible.push({ item, row, col });
      else if (index < slotCount) placeholders.push({ row, col });
    }
  }

  const handleScroll = () => {
    onScrollActivity();
    const node = scrollRef.current;
    if (!node || rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setViewport((c) => c.scrollTop === node.scrollTop ? c : { width: node.clientWidth, height: node.clientHeight, scrollTop: node.scrollTop });
    });
  };

  return (
    <div ref={scrollRef} style={S.virtualGrid} onScroll={handleScroll}>
      <div style={{ position: 'relative', height: totalHeight, minHeight: '100%' }}>
        {visible.map(({ item, row, col }) => {
          const left = GRID_PADDING_X + col * (columnWidth + GRID_GAP_X) + Math.max(0, (columnWidth - posterPrefs.width) / 2);
          const top = GRID_PADDING_TOP + row * rowStep;
          return (
            <div key={item.id} style={{ position: 'absolute', left, top, width: posterPrefs.width, height: itemHeight }}>
              <PosterCard
                meta={item}
                selected={selectedId === item.id}
                posterPrefs={posterPrefs}
                onHover={onHover}
                onClick={onClick}
              />
            </div>
          );
        })}
        {placeholders.map(({ row, col }) => {
          const left = GRID_PADDING_X + col * (columnWidth + GRID_GAP_X) + Math.max(0, (columnWidth - posterPrefs.width) / 2);
          const top = GRID_PADDING_TOP + row * rowStep;
          return (
            <div key={`ph-${row}-${col}`} style={{ position: 'absolute', left, top, width: posterPrefs.width, height: posterPrefs.height, borderRadius: posterPrefs.radius, background: '#1B212B', animation: 'pulse 1.6s ease-in-out infinite', animationDelay: `${(col % 8) * 0.07}s` }} />
          );
        })}
      </div>
    </div>
  );
}

const PosterCard = React.memo(function PosterCard({ meta, selected, posterPrefs, onHover, onClick }: {
  meta: Meta; selected: boolean; posterPrefs: PosterPrefs;
  onHover: (m: Meta | null) => boolean; onClick: (m: Meta) => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const src = posterPrefs.layout === 'horizontal'
    ? meta.background || meta.poster
    : meta.poster || meta.background;

  return (
    <div
      style={{ width: posterPrefs.width, cursor: 'pointer' }}
      onMouseEnter={() => onHover(meta)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(meta)}
    >
      <div style={{
        width: posterPrefs.width, height: posterPrefs.height,
        borderRadius: posterPrefs.radius, overflow: 'hidden', background: '#1B212B',
        outline: selected ? '0.1875rem solid rgba(255,255,255,0.9)' : 'none',
      }}>
        {src && !imgErr ? (
          <img src={src} alt={meta.name} loading="lazy" decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgErr(true)} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1B212B' }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '1.5rem', fontWeight: 900 }}>
              {(meta.name ?? '').slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>
      {!posterPrefs.hideTitles && (
        <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: '0.75rem', fontWeight: 600, margin: '0.4375rem 0 0', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta.name}
        </p>
      )}
    </div>
  );
});



const S: Record<string, React.CSSProperties> = {
  screen: {
    display: 'flex',
    width: 'calc(100% - 6.5rem)',
    height: 'calc(100% - 3.25rem)',
    marginLeft: '6.5rem',
    marginTop: '3.25rem',
    background: '#09091280',
    overflow: 'hidden',
  },
  left: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1rem 1.5rem',
    flexShrink: 0,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  backBtn: {
    width: '2.25rem', height: '2.25rem', borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.06)',
    color: '#FFFFFF', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, padding: 0,
  },
  title: {
    color: '#FFFFFF', fontSize: '1.125rem', fontWeight: 700,
    margin: 0, letterSpacing: '-0.01em',
  },
  count: {
    color: 'rgba(255,255,255,0.35)', fontSize: '0.8125rem',
    fontWeight: 500, marginLeft: '0.25rem',
  },
  tabBarWrap: {
    padding: '0.875rem 1.5rem 0',
    flexShrink: 0,
  },
  loadingGrid: {
    flex: 1,
    overflowY: 'hidden',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(9.375rem, 1fr))',
    gap: '1.75rem 1.125rem',
    padding: '1.25rem 1.5rem 3.75rem',
    alignContent: 'start',
  },
  virtualGrid: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    position: 'relative',
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(255,255,255,0.1) transparent',
    contain: 'strict',
    willChange: 'scroll-position',
  },
  right: {
    width: '18.75rem', flexShrink: 0,
    background: '#0C0D18',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    overflowY: 'auto', scrollbarWidth: 'none',
    display: 'flex', flexDirection: 'column',
  },
  panelEmpty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1.5rem',
  },
  panelEmptyText: {
    color: 'rgba(255,255,255,0.28)', fontSize: '0.8125rem',
    textAlign: 'center', margin: 0,
  },
  gridEmpty: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: '1.25rem', padding: '2rem',
  },
  errorTitle: {
    color: '#FFFFFF', fontSize: '1.5rem', fontWeight: 700,
    textAlign: 'center', margin: 0,
  },
  errorBody: {
    color: 'rgba(255,255,255,0.6)', fontSize: '1.0625rem',
    textAlign: 'center', margin: 0, maxWidth: '34rem', lineHeight: 1.6,
  },
};

const DP: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', display: 'flex', flexDirection: 'column', minHeight: '100%' },
  bg: { position: 'absolute', top: 0, left: 0, right: 0, height: '13.75rem', zIndex: 0, overflow: 'hidden' },
  bgImg: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', opacity: 0.4 },
  bgFade: { position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 0%, #0C0D18 100%)' },
  content: { position: 'relative', zIndex: 1, padding: '11.25rem 1.25rem 2rem', display: 'flex', flexDirection: 'column', flex: 1 },
  title: { color: '#FFFFFF', fontSize: '1.625rem', fontWeight: 900, margin: '0 0 0.625rem', lineHeight: 1.1, letterSpacing: '-0.0187rem' },
  metaRow: { display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '0.875rem', flexWrap: 'wrap' },
  metaItem: { color: 'rgba(255,255,255,0.65)', fontSize: '0.8125rem', fontWeight: 600 },
  imdbBadge: { display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#F5C518', borderRadius: '0.25rem', padding: '0.125rem 0.375rem' },
  imdbLabel: { color: '#000', fontSize: '0.625rem', fontWeight: 900 },
  imdbVal: { color: '#000', fontSize: '0.6875rem', fontWeight: 900 },
  desc: { color: 'rgba(255,255,255,0.65)', fontSize: '0.8125rem', lineHeight: '1.1875rem', margin: '0 0 1rem', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  section: { marginBottom: '0.875rem' },
  sectionLabel: { color: 'rgba(255,255,255,0.3)', fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.075rem', textTransform: 'uppercase', margin: '0 0 0.375rem' },
  genreChip: { color: 'rgba(255,255,255,0.65)', fontSize: '0.8125rem' },
  castName: { color: 'rgba(255,255,255,0.6)', fontSize: '0.8125rem' },
  actions: { display: 'flex', alignItems: 'center', gap: '0.625rem', marginTop: 'auto', paddingTop: '1.25rem', flexWrap: 'wrap' },
  playBtn: { display: 'inline-flex', alignItems: 'center', gap: '0.4375rem', height: '2.375rem', padding: '0 1.125rem', background: '#FFFFFF', color: '#000000', border: 'none', borderRadius: '0.5rem', fontSize: '0.8125rem', fontWeight: 900, cursor: 'pointer', flexShrink: 0 },
};
