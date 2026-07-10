import {
  coreParseAndPlanAddonResource,
  coreResourceFetchPlan,
} from './addonManifest';
import { coreResourceKindToResource } from './engine';
import { _appVersion, platformFetch } from './httpClient';
import type { AddonDescriptor, Video } from './types';

const FETCH_PLAN_CONCURRENCY = 12;
const STREAM_FETCH_TIMEOUT_MS = 30_000;

export type FetchPlanRequest = {
  url?: unknown;
  kind?: unknown;
  resource?: unknown;
  addonName?: unknown;
  stopOnFirstResult?: unknown;
};

export async function resourceForPlannedRequest(kind: unknown, requestResource?: unknown, itemResource?: unknown): Promise<string> {
  return coreResourceKindToResource(
    typeof kind === 'string' ? kind : '',
    typeof requestResource === 'string' ? requestResource : null,
    typeof itemResource === 'string' ? itemResource : null,
  );
}

export async function fetchParsedAddonResource(
  url: string,
  resource: string,
  kind: unknown,
  addonName?: unknown,
  season?: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  let statusCode = 0;
  let body: string | null = null;
  try {
    const response = await platformFetch(url, {
      headers: { 'User-Agent': `Fluxa/${_appVersion}` },
      signal: signal ?? (resource === 'stream' ? AbortSignal.timeout(STREAM_FETCH_TIMEOUT_MS) : undefined),
    });
    statusCode = response.status;
    body = await response.text();
  } catch {
    statusCode = 0;
  }
  const result = await coreParseAndPlanAddonResource(
    resource,
    url,
    statusCode,
    body,
    typeof kind === 'string' ? kind : '',
    typeof addonName === 'string' ? addonName : null,
    typeof season === 'number' ? season : null,
  );
  return result.kind === 'success' ? result.value : null;
}

export async function fetchPlannedResources(
  request: Record<string, unknown>,
  onPartialResult?: (result: unknown) => void,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const plan = await coreResourceFetchPlan(request);
  const requests = (plan?.requests ?? []) as FetchPlanRequest[];

  // When every request has stopOnFirstResult (e.g. metaDetail, seasonEpisodes),
  // fire all addon requests in parallel and take the first non-empty result.
  // This eliminates sequential per-addon latency: instead of waiting for each
  // addon to fail before trying the next, all race simultaneously.
  if (requests.length > 1 && requests.every((r) => r.stopOnFirstResult)) {
    const isNonEmpty = (parsed: Record<string, unknown> | null): parsed is Record<string, unknown> =>
      !!parsed && Object.values(parsed).some((v) => (Array.isArray(v) ? v.length > 0 : v != null));

    try {
      const result = await Promise.any(
        requests.map(async (item) => {
          const url = typeof item.url === 'string' ? item.url : '';
          if (!url) throw new Error('no url');
          const parsed = await fetchParsedAddonResource(
            url,
            await resourceForPlannedRequest(item.kind, request.resource, item.resource),
            item.kind,
            item.addonName,
            request.season,
            signal,
          );
          if (!isNonEmpty(parsed)) throw new Error('empty');
          return parsed;
        }),
      );
      return [result];
    } catch {
      return [];
    }
  }

  // Parallel path: fetch addon requests with bounded concurrency (firing all of them
  // at once for something like discover, which can fan out to dozens of addons,
  // causes a burst of concurrent network/JSON-parse/render work right as results land).
  // Each result is reported via onPartialResult as it arrives for progressive display.
  const values: unknown[] = [];
  await runWithConcurrency(requests, FETCH_PLAN_CONCURRENCY, async (item) => {
    const url = typeof item.url === 'string' ? item.url : '';
    if (!url) return;
    try {
      const parsed = await fetchParsedAddonResource(
        url,
        await resourceForPlannedRequest(item.kind, request.resource, item.resource),
        item.kind,
        item.addonName,
        request.season,
        signal,
      );
      if (parsed) {
        values.push(parsed);
        onPartialResult?.(parsed);
      }
    } catch {
      // tolerate individual addon failures, same as the previous Promise.allSettled behavior
    }
  });
  return values;
}

export async function fetchVideosForSeries(id: string, addons: AddonDescriptor[]): Promise<Video[]> {
  try {
    const values = await fetchPlannedResources({ kind: 'metaDetail', addons, contentType: 'series', id });
    const meta = (values.find((value) => (value as { meta?: unknown }).meta) as { meta?: { videos?: Video[] } } | undefined)?.meta;
    return Array.isArray(meta?.videos) ? meta.videos : [];
  } catch {
    return [];
  }
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
