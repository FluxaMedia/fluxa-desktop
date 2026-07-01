import React, { useMemo } from 'react';
import type { Meta } from '../core/types';
import { t } from '../i18n';

const ROW_PADDING_LEFT = 32;

const SCROLL_GAP = 12;
const BUFFER = 3;

function cardWidth(folder: Meta): number {
  const shape = ((folder as unknown as Record<string, unknown>).reason as string | undefined ?? 'poster').toLowerCase();
  if (shape === 'wide' || shape === 'landscape') return 280;
  if (shape === 'square') return 150;
  return 156;
}

export const CollectionShelfRow = React.memo(function CollectionShelfRow({
  title,
  folders,
  onFolderClick,
  addonIcon,
  gifAutoplayEnabled = true,
}: {
  title: string;
  folders: Meta[];
  onFolderClick: (f: Meta) => void;
  addonIcon?: string;
  gifAutoplayEnabled?: boolean;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(true);
  const [scrollLeft, setScrollLeft] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(() => window.innerWidth);
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const hoveredIdRef = React.useRef<string | null>(null);

  const slotWidth = useMemo(
    () => (folders.length > 0 ? cardWidth(folders[0]) + SCROLL_GAP : 168),
    [folders],
  );

  const updateArrows = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    const ro = new ResizeObserver(() => {
      if (el) setContainerWidth(el.clientWidth);
    });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      ro.disconnect();
    };
  }, [updateArrows, folders.length]);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    setScrollLeft(el.scrollLeft);
    hoveredIdRef.current = null;
    setHoveredId(null);
  }, [updateArrows]);

  const handleTileHover = React.useCallback((fid: string | null) => {
    if (hoveredIdRef.current === fid) return;
    hoveredIdRef.current = fid;
    setHoveredId(fid);
  }, []);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'right' ? 660 : -660, behavior: 'smooth' });
  };

  const startIdx = Math.max(0, Math.floor(scrollLeft / slotWidth) - BUFFER);
  const endIdx = Math.min(folders.length - 1, Math.ceil((scrollLeft + containerWidth) / slotWidth) + BUFFER);

  const visibleFolders = useMemo(
    () => folders.slice(startIdx, endIdx + 1),
    [folders, startIdx, endIdx],
  );

  const beforeWidth = startIdx > 0 ? startIdx * slotWidth - SCROLL_GAP : 0;
  const afterCount = folders.length - endIdx - 1;
  const afterWidth = afterCount > 0 ? afterCount * slotWidth - SCROLL_GAP : 0;

  return (
    <div style={collStyles.section}>
      <div style={headerStyles.header}>
        <p style={headerStyles.title}>{title}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            style={{ ...headerStyles.arrowBtn, opacity: canScrollLeft ? 1 : 0.28, cursor: canScrollLeft ? 'pointer' : 'default' }}
            onClick={() => canScrollLeft && scroll('left')}
            aria-label={t('common.scroll_left')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 18l-6-6 6-6v12z"/></svg>
          </button>
          <button
            style={{ ...headerStyles.arrowBtn, opacity: canScrollRight ? 1 : 0.28, cursor: canScrollRight ? 'pointer' : 'default' }}
            onClick={() => canScrollRight && scroll('right')}
            aria-label={t('common.scroll_right')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18l6-6-6-6v12z"/></svg>
          </button>
        </div>
      </div>
      <div ref={scrollRef} style={collStyles.scroll} onScroll={handleScroll}>
        {beforeWidth > 0 && <div style={{ width: beforeWidth, flexShrink: 0 }} />}
        {visibleFolders.map((folder) => (
          <FolderTileCard
            key={folder.id}
            folder={folder}
            isHovered={hoveredId === folder.id}
            onClick={onFolderClick}
            onHoverChange={handleTileHover}
            addonIcon={addonIcon}
            gifAutoplayEnabled={gifAutoplayEnabled}
          />
        ))}
        {afterWidth > 0 && <div style={{ width: afterWidth, flexShrink: 0 }} />}
      </div>
    </div>
  );
});

const FolderTileCard = React.memo(function FolderTileCard({
  folder,
  isHovered,
  onClick,
  onHoverChange,
  addonIcon,
  gifAutoplayEnabled,
}: {
  folder: Meta;
  isHovered: boolean;
  onClick: (f: Meta) => void;
  onHoverChange: (fid: string | null) => void;
  addonIcon?: string;
  gifAutoplayEnabled: boolean;
}) {
  const [staticImgError, setStaticImgError] = React.useState(false);
  const [gifError, setGifError] = React.useState(false);

  const shape = ((folder as unknown as Record<string, unknown>).reason as string | undefined ?? 'poster').toLowerCase();
  const isWide = shape === 'wide' || shape === 'landscape';
  const isSquare = shape === 'square';
  const w = cardWidth(folder);

  const imgStyle: React.CSSProperties = isWide
    ? { width: w, minWidth: w, height: 158 }
    : isSquare
    ? { width: w, minWidth: w, height: 150 }
    : { width: w, minWidth: w, height: 234 };

  const staticUrl = folder.poster ?? folder.background;
  const shouldShowGif = !!folder.focusGifUrl && !gifError && (gifAutoplayEnabled || isHovered);
  const displayUrl = shouldShowGif ? folder.focusGifUrl : staticUrl;
  const displayFailed = displayUrl === staticUrl && staticImgError;

  React.useEffect(() => {
    setStaticImgError(false);
    setGifError(false);
  }, [folder.id, folder.poster, folder.background, folder.focusGifUrl]);

  return (
    <div
      role="button"
      tabIndex={0}
      style={{ ...collStyles.tileWrapper, width: imgStyle.width, minWidth: imgStyle.minWidth }}
      onClick={() => onClick(folder)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(folder); } }}
      onPointerEnter={() => onHoverChange(folder.id)}
      onPointerLeave={() => onHoverChange(null)}
    >
      <div style={{
        ...collStyles.card,
        ...imgStyle,
        boxShadow: isHovered ? '0 0 0 2px var(--primary-accent-color, rgba(255,255,255,0.44))' : 'none',
        transform: isHovered ? 'translateY(-2px) scale(1.02)' : 'none',
      }}>
        {displayUrl && !displayFailed ? (
          <img
            key={displayUrl}
            src={displayUrl}
            alt={folder.name}
            loading="lazy"
            decoding="async"
            style={collStyles.img}
            onError={() => {
              if (displayUrl === folder.focusGifUrl) setGifError(true);
              else setStaticImgError(true);
            }}
          />
        ) : (
          <div style={collStyles.namePlaceholder}>
            {addonIcon ? (
              <img src={addonIcon} alt="" style={{ width: '48%', height: '48%', objectFit: 'contain', opacity: 0.35 }} />
            ) : (
              <span style={collStyles.namePlaceholderText}>{folder.name.slice(0, 1).toUpperCase()}</span>
            )}
          </div>
        )}
      </div>
      <p style={collStyles.folderName}>{folder.name}</p>
    </div>
  );
});

const headerStyles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: ROW_PADDING_LEFT,
    paddingRight: 32,
    marginBottom: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-0.01em',
  },
  arrowBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.76)',
    transition: 'opacity 0.15s',
    padding: 0,
  },
};

const collStyles: Record<string, React.CSSProperties> = {
  section: {
    position: 'relative',
    zIndex: 1,
    paddingTop: 8,
    marginBottom: 4,
    contain: 'layout style',
  },
  scroll: {
    display: 'flex',
    gap: 12,
    overflowX: 'auto',
    paddingLeft: ROW_PADDING_LEFT,
    paddingRight: 40,
    paddingBottom: 16,
    paddingTop: 4,
    scrollbarWidth: 'none',
    willChange: 'transform',
  },
  tileWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    cursor: 'pointer',
    outline: 'none',
    flexShrink: 0,
  },
  card: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    background: '#141922',
    transition: 'transform 0.16s ease, box-shadow 0.16s ease',
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  namePlaceholder: {
    width: '100%',
    height: '100%',
    background: '#1B212B',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  namePlaceholderText: {
    color: 'rgba(255,255,255,0.22)',
    fontSize: 48,
    fontWeight: 900,
  },
  folderName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 700,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
