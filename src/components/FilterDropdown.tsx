import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function FilterDropdown({
  value,
  options,
  onSelect,
}: {
  value: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button style={FD.trigger} onClick={() => setOpen((o) => !o)}>
        <span style={FD.label}>{value}</span>
        <ChevronDown
          size={16}
          style={{ flexShrink: 0, color: 'rgba(255,255,255,0.6)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>
      {open && (
        <div style={FD.menu}>
          {options.map((opt) => (
            <button
              key={opt.value}
              style={{
                ...FD.menuItem,
                background: opt.label === value ? 'rgba(255,255,255,0.12)' : 'transparent',
                fontWeight: opt.label === value ? 700 : 500,
              }}
              onClick={() => { onSelect(opt.value); setOpen(false); }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FD: Record<string, React.CSSProperties> = {
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    height: '2.25rem',
    padding: '0 0.75rem',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.5rem',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    fontWeight: 700,
    transition: 'background 0.15s',
  },
  label: {
    flex: 1,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 0.25rem)',
    left: 0,
    minWidth: '10rem',
    background: '#15161E',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.625rem',
    padding: '0.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.125rem',
    zIndex: 200,
    boxShadow: '0 0.5rem 2rem rgba(0,0,0,0.6)',
    maxHeight: '18.75rem',
    overflowY: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: 'rgba(255,255,255,0.1) transparent',
  },
  menuItem: {
    width: '100%',
    textAlign: 'left',
    padding: '0.5625rem 0.75rem',
    border: 'none',
    borderRadius: '0.4375rem',
    cursor: 'pointer',
    fontSize: '0.8125rem',
    color: '#FFFFFF',
    transition: 'background 0.12s',
  },
};
