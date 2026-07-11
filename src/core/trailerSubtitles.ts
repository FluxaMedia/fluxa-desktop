import type { YoutubeTrailerSubtitleTrack } from './engine';

export type TrailerCue = {
  start: number;
  end: number;
  text: string;
};

function normalizedLang(value: string | undefined | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed === 'none') return null;
  return trimmed.split(/[-_]/)[0] || null;
}

export function selectTrailerSubtitle(
  tracks: YoutubeTrailerSubtitleTrack[],
  preferred?: string,
  secondary?: string,
): YoutubeTrailerSubtitleTrack | null {
  if (tracks.length === 0) return null;
  const wanted = [
    normalizedLang(preferred),
    normalizedLang(secondary),
    normalizedLang(typeof navigator !== 'undefined' ? navigator.language : undefined),
    'en',
  ].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);

  const scored = tracks.map((track, index) => {
    const language = normalizedLang(track.languageTag);
    const label = track.label.toLowerCase();
    const wantedIndex = language ? wanted.indexOf(language) : -1;
    const preferredScore = wantedIndex >= 0 ? 1000 - (wantedIndex * 100) : 0;
    const englishLabelScore = label.includes('english') ? 250 : 0;
    const humanScore = track.isAuto ? 0 : 25;
    return { track, index, score: preferredScore + englishLabelScore + humanScore };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.track ?? null;
}

export function normalizeTrailerSubtitleUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('fmt', 'vtt');
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function parseTrailerSubtitleCues(input: string): TrailerCue[] {
  return input.trimStart().startsWith('<?xml') || input.trimStart().startsWith('<timedtext')
    ? parseYoutubeTimedText(input)
    : parseWebVtt(input);
}

function parseWebVtt(input: string): TrailerCue[] {
  return input
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .flatMap((block): TrailerCue[] => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return [];
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(lines[0])) return [];
      const timingIndex = lines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return [];
      const [startRaw, endAndSettings] = lines[timingIndex].split('-->');
      const start = parseVttTime(startRaw);
      const end = parseVttTime((endAndSettings ?? '').trim().split(/\s+/)[0]);
      const text = lines
        .slice(timingIndex + 1)
        .join('\n')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return [];
      return [{ start, end, text: decodeHtmlEntities(text) }];
    });
}

function parseYoutubeTimedText(input: string): TrailerCue[] {
  if (typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(input, 'text/xml');
  return Array.from(doc.querySelectorAll('p')).flatMap((node): TrailerCue[] => {
    const startMs = Number(node.getAttribute('t'));
    const durationMs = Number(node.getAttribute('d'));
    const text = node.textContent?.trim() ?? '';
    if (!Number.isFinite(startMs) || !Number.isFinite(durationMs) || !text) return [];
    return [{
      start: startMs / 1000,
      end: (startMs + durationMs) / 1000,
      text,
    }];
  });
}

function parseVttTime(raw: string | undefined): number {
  if (!raw) return NaN;
  const parts = raw.trim().replace(',', '.').split(':');
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop() ?? 0);
  const hours = Number(parts.pop() ?? 0);
  if (![hours, minutes, seconds].every(Number.isFinite)) return NaN;
  return (hours * 3600) + (minutes * 60) + seconds;
}

function decodeHtmlEntities(value: string): string {
  if (typeof document === 'undefined') return value;
  const el = document.createElement('textarea');
  el.innerHTML = value;
  return el.value;
}
