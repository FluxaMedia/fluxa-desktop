import React from 'react';
import type { LibraryContentType } from '../core/animeDetection';
import { t } from '../i18n';

export type TypeFilter = 'all' | LibraryContentType;

export interface TypeCounts {
  all: number;
  movie: number;
  series: number;
  anime: number;
}

export function ContentTypeFilter({
  value,
  counts,
  showCounts = true,
  onChange,
}: {
  value: TypeFilter;
  counts: TypeCounts;
  showCounts?: boolean;
  onChange: (v: TypeFilter) => void;
}) {
  const present = [counts.movie, counts.series, counts.anime].filter((n) => n > 0).length;
  if (present < 2) return null;
  const label = (base: string, n: number) => (showCounts ? `${base} (${n})` : base);
  return (
    <div style={styles.row}>
      <Chip active={value === 'all'} onClick={() => onChange('all')}>{label(t('auto.all'), counts.all)}</Chip>
      {counts.movie > 0 && (
        <Chip active={value === 'movie'} onClick={() => onChange('movie')}>{label(t('auto.movies'), counts.movie)}</Chip>
      )}
      {counts.series > 0 && (
        <Chip active={value === 'series'} onClick={() => onChange('series')}>{label(t('auto.series'), counts.series)}</Chip>
      )}
      {counts.anime > 0 && (
        <Chip active={value === 'anime'} onClick={() => onChange('anime')}>{label(t('auto.anime'), counts.anime)}</Chip>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      style={{
        background: active ? 'rgba(255,255,255,0.14)' : hovered ? 'rgba(255,255,255,0.07)' : 'transparent',
        color: active ? '#FFFFFF' : 'rgba(255,255,255,0.6)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '5px 14px',
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
        transition: 'background 0.15s, color 0.15s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
};
