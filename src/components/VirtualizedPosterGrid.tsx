import React, { useEffect, useRef, useState } from 'react';
import type { PosterPrefs } from '../core/posterPrefs';
import type { Meta } from '../core/types';
import { cardImageUrl } from '../core/imageSizes';

const GRID_PADDING_X = 24;
const GRID_PADDING_TOP = 12;
const GRID_PADDING_BOTTOM = 60;
const GRID_GAP_X = 18;
const GRID_GAP_Y = 28;
const GRID_MIN_COLUMN_WIDTH = 150;
const GRID_OVERSCAN_ROWS = 6;

export const VirtualizedPosterGrid = React.memo(function VirtualizedPosterGrid({
  items,
  selectedId,
  posterPrefs,
  onHover,
  onClick,
  onScrollActivity,
}: {
  items: Meta[];
  selectedId: string | null;
  posterPrefs: PosterPrefs;
  onHover: (m: Meta | null) => boolean;
  onClick: (m: Meta) => void;
  onScrollActivity: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    let raf: number | null = null;
    const update = () => {
      setViewport({ width: node.clientWidth, height: node.clientHeight, scrollTop: node.scrollTop });
    };
    const onResize = () => {
      if (raf != null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { raf = null; update(); });
    };
    update();
    const observer = new ResizeObserver(onResize);
    observer.observe(node);
    return () => { observer.disconnect(); if (raf != null) cancelAnimationFrame(raf); };
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
  const rowCount = Math.ceil(items.length / columns);
  const totalHeight = GRID_PADDING_TOP + GRID_PADDING_BOTTOM + Math.max(0, rowCount * itemHeight + Math.max(0, rowCount - 1) * GRID_GAP_Y);
  const startRow = Math.max(0, Math.floor((viewport.scrollTop - GRID_PADDING_TOP) / rowStep) - GRID_OVERSCAN_ROWS);
  const endRow = Math.min(
    rowCount,
    Math.ceil((viewport.scrollTop + viewport.height - GRID_PADDING_TOP) / rowStep) + GRID_OVERSCAN_ROWS,
  );

  const visible: Array<{ item: Meta; index: number; row: number; col: number }> = [];
  for (let row = startRow; row < endRow; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = row * columns + col;
      const item = items[index];
      if (!item) continue;
      visible.push({ item, index, row, col });
    }
  }

  const handleScroll = () => {
    onScrollActivity();
    const node = scrollRef.current;
    if (!node || rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setViewport((current) =>
        current.scrollTop === node.scrollTop
          ? current
          : { width: node.clientWidth, height: node.clientHeight, scrollTop: node.scrollTop },
      );
    });
  };

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255,255,255,0.1) transparent',
        contain: 'strict',
        willChange: 'scroll-position',
      }}
      onScroll={handleScroll}
    >
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
      </div>
    </div>
  );
});

const PosterCard = React.memo(function PosterCard({
  meta,
  selected,
  posterPrefs,
  onHover,
  onClick,
}: {
  meta: Meta;
  selected: boolean;
  posterPrefs: PosterPrefs;
  onHover: (m: Meta | null) => boolean;
  onClick: (m: Meta) => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const imgSrc = posterPrefs.layout === 'horizontal'
    ? cardImageUrl(meta.background, 'backdrop') || cardImageUrl(meta.poster)
    : cardImageUrl(meta.poster) || cardImageUrl(meta.background, 'backdrop');

  return (
    <div
      role="button"
      tabIndex={0}
      style={{ width: posterPrefs.width, cursor: 'pointer' }}
      onMouseEnter={() => onHover(meta)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(meta)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(meta);
        }
      }}
      aria-label={meta.name}
    >
      <div
        style={{
          width: posterPrefs.width,
          height: posterPrefs.height,
          borderRadius: posterPrefs.radius,
          overflow: 'hidden',
          background: '#1B212B',
          boxShadow: selected ? 'inset 0 0 0 2px rgba(255,255,255,0.55), 0 0 12px rgba(255,255,255,0.08)' : 'none',
        }}
      >
        {imgSrc && !imgErr ? (
          <img
            src={imgSrc}
            alt={meta.name}
            loading="lazy"
            decoding="async"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgErr(true)}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1B212B' }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 24, fontWeight: 900 }}>
              {meta.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}
      </div>
      {!posterPrefs.hideTitles && (
        <p style={{
          color: 'rgba(255,255,255,0.72)',
          fontSize: 12,
          fontWeight: 600,
          margin: '4px 0 0',
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {meta.name}
        </p>
      )}
    </div>
  );
});
