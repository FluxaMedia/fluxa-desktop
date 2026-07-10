const TMDB_WIDTHS: Record<string, number> = {
  w92: 92,
  w154: 154,
  w185: 185,
  w300: 300,
  w342: 342,
  w500: 500,
  w780: 780,
  w1280: 1280,
};

const TMDB_RE = /^(https?:\/\/image\.tmdb\.org\/t\/p\/)([^/]+)(\/.+)$/;

export function cardImageUrl(url: string | undefined, kind: 'poster' | 'backdrop' = 'poster'): string | undefined {
  if (!url) return url;
  const match = url.match(TMDB_RE);
  if (!match) return url;
  const target = kind === 'poster' ? 'w300' : 'w780';
  const current = TMDB_WIDTHS[match[2]];
  if (current !== undefined && current <= TMDB_WIDTHS[target]) return url;
  return `${match[1]}${target}${match[3]}`;
}
