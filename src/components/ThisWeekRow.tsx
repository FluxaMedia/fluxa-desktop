import React from 'react';
import type { Meta } from '../core/types';
import { continueWatchingCardFields } from '../core/continueWatchingUtils';
import { ContinueCard } from './ContinueCard';
import { t } from '../i18n';

const ROW_PADDING_LEFT = 32;

export const ThisWeekRow = React.memo(function ThisWeekRow({
  items,
  artworkPreference,
  onItemClick,
}: {
  items: Meta[];
  artworkPreference: string;
  onItemClick: (m: Meta) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const [cardFields, setCardFields] = React.useState<Map<string, { artwork: string | null; episodeLine: string }>>(new Map());

  React.useEffect(() => {
    let cancelled = false;
    void continueWatchingCardFields(items, artworkPreference, true).then((fields) => {
      if (!cancelled) setCardFields(fields);
    });
    return () => { cancelled = true; };
  }, [items, artworkPreference]);

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
    return () => el.removeEventListener('scroll', updateArrows);
  }, [updateArrows, items.length]);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'right' ? 660 : -660, behavior: 'smooth' });
  };

  const noop = React.useCallback(() => {}, []);

  return (
    <div style={twStyles.section}>
      <div style={twStyles.header}>
        <p style={twStyles.title}>{t('auto.this_week')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {canScrollLeft && (
            <button style={twStyles.arrowBtn} onClick={() => scroll('left')} aria-label={t('common.scroll_left')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 18l-6-6 6-6v12z" /></svg>
            </button>
          )}
          {canScrollRight && (
            <button style={twStyles.arrowBtn} onClick={() => scroll('right')} aria-label={t('common.scroll_right')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18l6-6-6-6v12z" /></svg>
            </button>
          )}
        </div>
      </div>
      <div ref={scrollRef} style={twStyles.scroll}>
        {items.map((meta) => (
          <ContinueCard
            key={meta.id}
            meta={meta}
            isHorizontal
            artwork={cardFields.get(meta.id)?.artwork ?? null}
            episodeLine={cardFields.get(meta.id)?.episodeLine ?? null}
            remainingFormat="time"
            progressDirection="remaining"
            dismissing={false}
            hideActions
            onClick={onItemClick}
            onMarkWatched={noop}
            onDrop={noop}
            onDismissAnimationEnd={noop}
          />
        ))}
      </div>
    </div>
  );
});

const twStyles: Record<string, React.CSSProperties> = {
  section: { position: 'relative', zIndex: 1, paddingTop: 8, marginBottom: 0 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: ROW_PADDING_LEFT, paddingRight: 32, marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
  arrowBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.76)', transition: 'opacity 0.15s', padding: 0 },
  scroll: { display: 'flex', gap: 18, overflowX: 'auto', paddingLeft: ROW_PADDING_LEFT, paddingRight: 40, paddingBottom: 16, paddingTop: 4, scrollbarWidth: 'none' },
};
