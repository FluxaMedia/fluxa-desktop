import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export const POPOVER_SURFACE: CSSProperties = {
  background: '#1A1A1A',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.625rem',
  boxShadow: '0 0.5rem 2rem rgba(0,0,0,0.6)',
  scrollbarWidth: 'thin',
  scrollbarColor: 'rgba(255,255,255,0.10) transparent',
};

type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top-end' | 'top';

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  point?: { x: number; y: number } | null;
  placement?: Placement;
  gap?: number;
  matchWidth?: boolean;
  width?: number | string;
  maxWidth?: number | string;
  maxHeight?: number | string;
  padding?: string;
  zIndex?: number;
  children: ReactNode;
}

const VIEWPORT_MARGIN = 8;

export function Popover({
  open, onClose, anchorRef, point, placement = 'bottom-end', gap = 8,
  matchWidth, width, maxWidth, maxHeight, padding = '0.375rem 0', zIndex = 10000, children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; anchorWidth?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const compute = () => {
      const panel = panelRef.current;
      const pw = panel?.offsetWidth ?? 0;
      const ph = panel?.offsetHeight ?? 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let top: number;
      let left: number;
      let anchorWidth: number | undefined;

      if (anchorRef?.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        anchorWidth = rect.width;
        const onTop = placement.startsWith('top');
        top = onTop ? rect.top - gap - ph : rect.bottom + gap;
        if (placement.endsWith('end')) left = rect.right - (matchWidth ? anchorWidth : pw);
        else if (placement.endsWith('start')) left = rect.left;
        else left = rect.left + rect.width / 2 - (matchWidth ? anchorWidth : pw) / 2;
      } else if (point) {
        top = point.y;
        left = point.x;
      } else {
        return;
      }

      left = Math.min(Math.max(left, VIEWPORT_MARGIN), vw - pw - VIEWPORT_MARGIN);
      top = Math.min(Math.max(top, VIEWPORT_MARGIN), vh - ph - VIEWPORT_MARGIN);
      setPosition({ top, left, anchorWidth });
    };

    compute();
    window.addEventListener('resize', compute);
    const observer = panelRef.current ? new ResizeObserver(compute) : null;
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      window.removeEventListener('resize', compute);
      observer?.disconnect();
    };
  }, [open, anchorRef, point?.x, point?.y, placement, gap, matchWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="ui-popover"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        ...POPOVER_SURFACE,
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? 'visible' : 'hidden',
        padding,
        width: matchWidth && position?.anchorWidth ? position.anchorWidth : width,
        maxWidth,
        maxHeight,
        overflowX: 'hidden',
        overflowY: maxHeight ? 'auto' : 'hidden',
        zIndex,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
