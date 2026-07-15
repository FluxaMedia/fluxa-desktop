import type { Meta, Stream, Video } from './types';

export function streamSourceLink(stream: Stream): string | undefined {
  return stream.url ?? stream.infoHash ?? undefined;
}

export function streamDownloadLink(stream: Stream): string | undefined {
  return stream.playableUrl ?? stream.url ?? undefined;
}

export function streamIsTorrent(stream: Stream): boolean {
  if (stream.infoHash || stream.isTorrent) return true;
  const link = stream.url?.toLowerCase();
  return !!link && (link.startsWith('magnet:') || link.startsWith('stremio://torrent/') || link.startsWith('infohash:'));
}

export function buildOfflineDownloadRequest(meta: Meta, stream: Stream, video?: Video | null) {
  return {
    downloadId: crypto.randomUUID(),
    meta,
    video: video ?? undefined,
    stream,
  };
}
