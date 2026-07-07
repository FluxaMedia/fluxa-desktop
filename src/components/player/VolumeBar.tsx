import { useCallback, useEffect, useRef } from 'react';

export function VolumeBar({ value, max, onChange, forceTooltip }: { value: number; max: number; onChange: (v: number) => void; forceTooltip?: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hovering = useRef(false);
  const pendingValue = useRef<number | null>(null);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTooltip = useCallback((v: number, pct: string) => {
    if (tooltipRef.current) {
      tooltipRef.current.textContent = `${Math.round(v)}%`;
      tooltipRef.current.style.left = pct;
    }
  }, []);

  const setTooltipVisible = useCallback((visible: boolean) => {
    if (tooltipRef.current) tooltipRef.current.style.opacity = visible ? '1' : '0';
  }, []);

  const applyX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const v = Math.round(frac * max);
    const pct = `${(frac * 100).toFixed(2)}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (dotRef.current) dotRef.current.style.left = pct;
    setTooltip(v, pct);
    pendingValue.current = v;
    if (!throttleTimer.current) {
      throttleTimer.current = setTimeout(() => {
        throttleTimer.current = null;
        if (pendingValue.current !== null) { onChange(pendingValue.current); pendingValue.current = null; }
      }, 40);
    }
  }, [max, onChange, setTooltip]);

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (throttleTimer.current) { clearTimeout(throttleTimer.current); throttleTimer.current = null; }
      if (pendingValue.current !== null) { onChange(pendingValue.current); pendingValue.current = null; }
      if (!hovering.current) setTooltipVisible(false);
    };
    const move = (e: MouseEvent) => { if (dragging.current) applyX(e.clientX); };
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('mousemove', move);
      if (throttleTimer.current) clearTimeout(throttleTimer.current);
    };
  }, [applyX, onChange, setTooltipVisible]);

  useEffect(() => {
    const pct = `${Math.min(100, (value / max) * 100).toFixed(2)}%`;
    setTooltip(value, pct);
    if (dragging.current) return;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (dotRef.current) dotRef.current.style.left = pct;
  }, [value, max, setTooltip]);

  useEffect(() => {
    if (forceTooltip) setTooltipVisible(true);
    else if (!hovering.current && !dragging.current) setTooltipVisible(false);
  }, [forceTooltip, setTooltipVisible]);

  const initPct = `${Math.min(100, (value / max) * 100).toFixed(2)}%`;
  return (
    <div
      ref={trackRef}
      style={{ position: 'relative', width: 80, height: 20, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center' }}
      onMouseDown={(e) => { e.stopPropagation(); dragging.current = true; applyX(e.clientX); }}
      onMouseEnter={() => { hovering.current = true; setTooltipVisible(true); }}
      onMouseLeave={() => { hovering.current = false; if (!dragging.current) setTooltipVisible(false); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          bottom: '100%',
          left: initPct,
          transform: 'translate(-50%, -8px)',
          background: 'rgba(20,20,20,0.92)',
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.12s ease',
        }}
      />
      <div style={{ position: 'absolute', left: 0, right: 0, height: 3, top: '50%', transform: 'translateY(-50%)', background: 'rgba(255,255,255,0.2)', borderRadius: 2 }} />
      <div ref={fillRef} style={{ position: 'absolute', left: 0, width: initPct, height: 3, top: '50%', transform: 'translateY(-50%)', background: '#fff', borderRadius: 2 }} />
      <div ref={dotRef} style={{ position: 'absolute', left: initPct, top: '50%', width: 11, height: 11, borderRadius: '50%', background: '#fff', transform: 'translate(-50%, -50%)', boxShadow: '0 1px 4px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
    </div>
  );
}
