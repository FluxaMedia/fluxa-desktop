import React, { useMemo } from 'react';
import type { Meta } from '../core/types';
import { t } from '../i18n';
import { cardImageUrl } from '../core/imageSizes';
import { useInViewport } from '../hooks/useInViewport';
import { useGifSlot } from '../hooks/useGifSlot';
import { useDragScroll } from '../hooks/useDragScroll';

const ROW_PADDING_LEFT = '2rem';

const SCROLL_GAP = 12;
const BUFFER = 3;
const MAX_STATIC_IMAGE_RETRIES = 2;

function retryImageUrl(url: string, retryKey: number): string {
  if (retryKey <= 0 || url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('__fluxa_img_retry', String(retryKey));
    return parsed.toString();
  } catch {
    const joiner = url.includes('?') ? '&' : '?';
    return `${url}${joiner}__fluxa_img_retry=${retryKey}`;
  }
}

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
  const dragScroll = useDragScroll(scrollRef);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(true);
  const [scrollLeft, setScrollLeft] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(() => window.innerWidth);
  const scrollRafRef = React.useRef<number | null>(null);

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
    if (!el || scrollRafRef.current != null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateArrows();
      setScrollLeft((current) => (el.scrollLeft === current ? current : el.scrollLeft));
    });
  }, [updateArrows]);

  React.useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) window.cancelAnimationFrame(scrollRafRef.current);
    };
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
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
      <div ref={scrollRef} style={collStyles.scroll} onScroll={handleScroll} {...dragScroll}>
        {beforeWidth > 0 && <div style={{ width: beforeWidth, flexShrink: 0 }} />}
        {visibleFolders.map((folder) => (
          <FolderTileCard
            key={folder.id}
            folder={folder}
            onClick={onFolderClick}
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
  onClick,
  addonIcon,
  gifAutoplayEnabled,
}: {
  folder: Meta;
  onClick: (f: Meta) => void;
  addonIcon?: string;
  gifAutoplayEnabled: boolean;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [staticImgError, setStaticImgError] = React.useState(false);
  const [staticRetryKey, setStaticRetryKey] = React.useState(0);
  const staticRetriesRef = React.useRef(0);
  const staticRetryTimersRef = React.useRef<number[]>([]);
  const [gifError, setGifError] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inViewport = useInViewport(wrapperRef, '150px');

  const handleStaticError = React.useCallback(() => {
    if (staticRetriesRef.current < MAX_STATIC_IMAGE_RETRIES) {
      staticRetriesRef.current += 1;
      const retry = staticRetriesRef.current;
      const timer = window.setTimeout(() => {
        staticRetryTimersRef.current = staticRetryTimersRef.current.filter((id) => id !== timer);
        setStaticRetryKey(retry);
      }, 400 * retry);
      staticRetryTimersRef.current.push(timer);
    } else {
      setStaticImgError(true);
    }
  }, []);

  const shape = ((folder as unknown as Record<string, unknown>).reason as string | undefined ?? 'poster').toLowerCase();
  const isWide = shape === 'wide' || shape === 'landscape';
  const isSquare = shape === 'square';
  const w = cardWidth(folder);

  const imgStyle: React.CSSProperties = isWide
    ? { width: w, minWidth: w, height: '9.875rem' }
    : isSquare
    ? { width: w, minWidth: w, height: '9.375rem' }
    : { width: w, minWidth: w, height: '14.625rem' };

  const staticUrl = cardImageUrl(folder.poster) ?? cardImageUrl(folder.background, 'backdrop');
  const staticSrc = staticUrl ? retryImageUrl(staticUrl, staticRetryKey) : undefined;
  const hasStatic = !!staticUrl && !staticImgError;
  const gifEligible = !!folder.focusGifUrl && inViewport && (gifAutoplayEnabled || hovered) && !gifError;
  const hasGifSlot = useGifSlot(folder.id, gifEligible);
  const wantsMotion = gifEligible && hasGifSlot;
  const showPlaceholder = !hasStatic && !wantsMotion;

  React.useEffect(() => {
    setStaticImgError(false);
    setGifError(false);
    staticRetriesRef.current = 0;
    setStaticRetryKey(0);
    staticRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    staticRetryTimersRef.current = [];
  }, [folder.id, folder.poster, folder.background, folder.focusGifUrl, staticUrl]);

  React.useEffect(() => {
    return () => {
      staticRetryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      staticRetryTimersRef.current = [];
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      role="button"
      tabIndex={0}
      className="folder-tile"
      style={{ ...collStyles.tileWrapper, width: imgStyle.width, minWidth: imgStyle.minWidth }}
      onClick={() => onClick(folder)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(folder); } }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        className="folder-card"
        data-motion-url={folder.focusGifUrl ?? undefined}
        style={{ ...collStyles.card, ...imgStyle }}
      >
        {hasStatic && (
          <img
            key={staticRetryKey}
            src={staticSrc}
            alt={folder.name}
            loading="lazy"
            decoding="async"
            style={collStyles.img}
            onError={handleStaticError}
          />
        )}
        {wantsMotion && (
          <img
            src={folder.focusGifUrl}
            alt=""
            loading="lazy"
            style={{ ...collStyles.img, position: 'absolute', inset: 0 }}
            onError={() => setGifError(true)}
          />
        )}
        {showPlaceholder && (
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
    paddingRight: '2rem',
    marginBottom: '0.75rem',
  },
  title: {
    color: '#FFFFFF',
    fontSize: '1.125rem',
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-0.01em',
  },
  arrowBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.75rem',
    height: '1.75rem',
    borderRadius: '62.4375rem',
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
    paddingTop: '0.5rem',
    marginBottom: '0.25rem',
    contain: 'layout style',
  },
  scroll: {
    display: 'flex',
    gap: '0.75rem',
    overflowX: 'auto',
    paddingLeft: ROW_PADDING_LEFT,
    paddingRight: '2.5rem',
    paddingBottom: '1rem',
    paddingTop: '0.25rem',
    scrollbarWidth: 'none',
    willChange: 'transform',
  },
  tileWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
    cursor: 'pointer',
    outline: 'none',
    flexShrink: 0,
  },
  card: {
    position: 'relative',
    borderRadius: '0.5rem',
    overflow: 'hidden',
    background: '#141922',
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
    fontSize: '3rem',
    fontWeight: 900,
  },
  folderName: {
    color: '#FFFFFF',
    fontSize: '0.8125rem',
    fontWeight: 700,
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
