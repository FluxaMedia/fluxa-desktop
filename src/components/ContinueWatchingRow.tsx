import React from 'react';
import type { Meta } from '../core/types';
import { markContinueWatchingItemWatched, dropContinueWatchingItem, continueWatchingCardFields } from '../core/continueWatchingUtils';
import { ContinueCard } from './ContinueCard';
import { t } from '../i18n';

const ROW_PADDING_LEFT = 32;

// Module-level so it survives this row unmounting when you navigate away from Home and
// remounting when you come back — without this, every Home revisit re-fetched artwork/
// episode-line fields for the whole row from scratch even when nothing had changed.
let lastCardFieldsKey: string | null = null;
let lastCardFields: Map<string, { artwork: string | null; episodeLine: string }> = new Map();

export const ContinueWatchingRow = React.memo(function ContinueWatchingRow({
  items,
  cwLayout,
  artworkPreference,
  remainingFormat,
  progressDirection,
  onItemClick,
  onDispatch,
}: {
  items: Meta[];
  cwLayout: string;
  artworkPreference: string;
  remainingFormat: string;
  progressDirection: string;
  onItemClick: (m: Meta) => void;
  onDispatch: (actionJson: string) => void | Promise<void>;
}) {
  const isHorizontal = cwLayout !== 'vertical';
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const [dismissingIds, setDismissingIds] = React.useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(new Set());

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

  const visibleItems = React.useMemo(
    () => items.filter((meta) => !dismissedIds.has(meta.id)),
    [items, dismissedIds],
  );

  const [cardFields, setCardFields] = React.useState(lastCardFields);
  const cardFieldsKey = `${artworkPreference}|${isHorizontal}|${visibleItems.map((m) => m.id).join(',')}`;
  React.useEffect(() => {
    if (cardFieldsKey === lastCardFieldsKey) {
      setCardFields(lastCardFields);
      return;
    }
    let cancelled = false;
    void continueWatchingCardFields(visibleItems, artworkPreference, isHorizontal).then((fields) => {
      if (cancelled) return;
      lastCardFieldsKey = cardFieldsKey;
      lastCardFields = fields;
      setCardFields(fields);
    });
    return () => { cancelled = true; };
  }, [cardFieldsKey, visibleItems, artworkPreference, isHorizontal]);

  const startDismiss = (item: Meta, action: () => void) => {
    setDismissingIds((prev) => { const n = new Set(prev); n.add(item.id); return n; });
    action();
  };

  return (
    <div style={cwStyles.section}>
      <div style={cwStyles.header}>
        <p style={cwStyles.title}>{t('auto.continue_watching')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            style={{ ...cwStyles.arrowBtn, opacity: canScrollLeft ? 1 : 0.28, cursor: canScrollLeft ? 'pointer' : 'default' }}
            onClick={() => canScrollLeft && scroll('left')}
            aria-label={t('common.scroll_left')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 18l-6-6 6-6v12z" /></svg>
          </button>
          <button
            style={{ ...cwStyles.arrowBtn, opacity: canScrollRight ? 1 : 0.28, cursor: canScrollRight ? 'pointer' : 'default' }}
            onClick={() => canScrollRight && scroll('right')}
            aria-label={t('common.scroll_right')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18l6-6-6-6v12z" /></svg>
          </button>
        </div>
      </div>
      <div ref={scrollRef} style={cwStyles.scroll}>
        {visibleItems.map((meta) => (
          <ContinueCard
            key={meta.id}
            meta={meta}
            isHorizontal={isHorizontal}
            artwork={cardFields.get(meta.id)?.artwork ?? null}
            episodeLine={cardFields.get(meta.id)?.episodeLine ?? null}
            remainingFormat={remainingFormat}
            progressDirection={progressDirection}
            dismissing={dismissingIds.has(meta.id)}
            onClick={onItemClick}
            onMarkWatched={(item) => startDismiss(item, () => void markContinueWatchingItemWatched(item, onDispatch))}
            onDrop={(item) => startDismiss(item, () => void dropContinueWatchingItem(item, onDispatch))}
            onDismissAnimationEnd={(item) => {
              setDismissedIds((prev) => new Set([...prev, item.id]));
              setDismissingIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
            }}
          />
        ))}
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.cwLayout !== next.cwLayout || prev.artworkPreference !== next.artworkPreference ||
      prev.remainingFormat !== next.remainingFormat || prev.progressDirection !== next.progressDirection ||
      prev.onItemClick !== next.onItemClick || prev.onDispatch !== next.onDispatch) return false;
  if (prev.items === next.items) return true;
  if (prev.items.length !== next.items.length) return false;
  return prev.items.every((item, i) => {
    const pi = item as unknown as Record<string, unknown>;
    const ni = next.items[i] as unknown as Record<string, unknown>;
    return pi.id === ni.id && pi.timeOffset === ni.timeOffset && pi.duration === ni.duration;
  });
});

const cwStyles: Record<string, React.CSSProperties> = {
  section: { position: 'relative', zIndex: 1, paddingTop: 8, marginBottom: 0 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: ROW_PADDING_LEFT, paddingRight: 32, marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' },
  arrowBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 999, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.76)', transition: 'opacity 0.15s', padding: 0 },
  scroll: { display: 'flex', gap: 18, overflowX: 'auto', paddingLeft: ROW_PADDING_LEFT, paddingRight: 40, paddingBottom: 16, paddingTop: 4, scrollbarWidth: 'none' },
};
