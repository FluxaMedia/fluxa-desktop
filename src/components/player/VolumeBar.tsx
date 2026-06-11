import { useCallback, useEffect, useRef } from 'react';

export function VolumeBar({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pendingValue = useRef<number | null>(null);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.round(frac * max);
    const pct = `${(frac * 100).toFixed(2)}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (dotRef.current) dotRef.current.style.left = pct;
    pendingValue.current = v;
    if (!throttleTimer.current) {
      throttleTimer.current = setTimeout(() => {
        throttleTimer.current = null;
        if (pendingValue.current !== null) { onChange(pendingValue.current); pendingValue.current = null; }
      }, 40);
    }
  }, [max, onChange]);

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (throttleTimer.current) { clearTimeout(throttleTimer.current); throttleTimer.current = null; }
      if (pendingValue.current !== null) { onChange(pendingValue.current); pendingValue.current = null; }
    };
    const move = (e: MouseEvent) => { if (dragging.current) applyX(e.clientX); };
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('mousemove', move);
      if (throttleTimer.current) clearTimeout(throttleTimer.current);
    };
  }, [applyX, onChange]);

  useEffect(() => {
    if (dragging.current) return;
    const pct = `${Math.min(100, (value / max) * 100).toFixed(2)}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (dotRef.current) dotRef.current.style.left = pct;
  }, [value, max]);

  const initPct = `${Math.min(100, (value / max) * 100).toFixed(2)}%`;
  return (
    <div
      ref={trackRef}
      style={{ position: 'relative', width: 80, height: 20, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' }}
      onMouseDown={(e) => { e.stopPropagation(); dragging.current = true; applyX(e.clientX); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, height: 3, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.2)', borderRadius: 2 }} />
      <div ref={fillRef} style={{ position: 'absolute', left: 0, width: initPct, height: 3, top: '50%', transform: 'translateY(-50%)', background: '#fff', borderRadius: 2 }} />
      <div ref={dotRef} style={{ position: 'absolute', left: initPct, top: '50%', width: 11, height: 11, borderRadius: '50%', background: '#fff', transform: 'translate(-50%, -50%)', boxShadow: '0 1px 4px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
    </div>
  );
}
