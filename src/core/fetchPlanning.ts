import {
  coreParseAndPlanAddonResource,
  coreResourceFetchPlan,
} from './addonManifest';
import { coreResourceKindToResource } from './engine';
import { _appVersion, platformFetch } from './httpClient';
import { loadPrefs } from './libraryOps';
import { fetchBuiltinCatalog, fetchBuiltinMeta, fetchBuiltinSeasonEpisodes, isBuiltinTmdbAddon } from './tmdbAddon';
import type { AddonDescriptor, Video } from './types';

const FETCH_PLAN_CONCURRENCY = 12;
const STREAM_FETCH_TIMEOUT_MS = 60_000;
const STREAM_RETRY_TIMEOUT_MS = 20_000;
const STREAM_MAX_ATTEMPTS = 3;

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

type BuiltinFetchPlanRequest = FetchPlanRequest & { __builtinResolve: () => Promise<Record<string, unknown> | null> };

const BUILTIN_RESOURCE_KINDS = new Set(['metaDetail', 'seasonEpisodes', 'catalogPage']);

function isBuiltinRequest(item: FetchPlanRequest): item is BuiltinFetchPlanRequest {
  return typeof (item as Partial<BuiltinFetchPlanRequest>).__builtinResolve === 'function';
}

async function buildBuiltinRequest(request: Record<string, unknown>): Promise<BuiltinFetchPlanRequest | null> {
  const kind = request.kind;
  if (typeof kind !== 'string' || !BUILTIN_RESOURCE_KINDS.has(kind)) return null;
  if (kind === 'catalogPage' && !isBuiltinTmdbAddon(request.transportUrl as string | undefined)) return null;

  const prefs = await loadPrefs();
  const apiKey = String(prefs.tmdbApiKey ?? '').trim();
  if (!apiKey) return null;
  const language = String(prefs.language ?? 'en');

  if (kind === 'catalogPage') {
    const extra: Record<string, unknown> = {};
    if (request.genre) extra.genre = request.genre;
    if (request.search) extra.search = request.search;
    if (request.skip) extra.skip = request.skip;
    return {
      stopOnFirstResult: false,
      addonName: 'TMDB',
      __builtinResolve: async () => {
        const { metas } = await fetchBuiltinCatalog(String(request.contentType ?? ''), extra, apiKey, language);
        return metas.length ? { items: metas } : null;
      },
    };
  }

  if (kind === 'seasonEpisodes') {
    return {
      stopOnFirstResult: true,
      addonName: 'TMDB',
      __builtinResolve: async () => {
        const result = await fetchBuiltinSeasonEpisodes(String(request.id ?? ''), Number(request.season ?? 0), apiKey, language);
        return result.episodes.length ? result : null;
      },
    };
  }

  return {
    stopOnFirstResult: true,
    addonName: 'TMDB',
    __builtinResolve: async () => {
      const result = await fetchBuiltinMeta(String(request.contentType ?? ''), String(request.id ?? ''), apiKey, language);
      return result ? { meta: result.meta } : null;
    },
  };
}

type AddonFetchOutcome = { value: Record<string, unknown> | null; failed: boolean };

async function fetchAddonResourceOutcome(
  url: string,
  resource: string,
  kind: unknown,
  addonName?: unknown,
  season?: unknown,
  signal?: AbortSignal,
): Promise<AddonFetchOutcome> {
  const canRetry = resource === 'stream' && !signal;
  const maxAttempts = canRetry ? STREAM_MAX_ATTEMPTS : 1;
  let result: Awaited<ReturnType<typeof coreParseAndPlanAddonResource>> | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let statusCode = 0;
    let body: string | null = null;
    try {
      const response = await platformFetch(url, {
        headers: { 'User-Agent': `Fluxa/${_appVersion}` },
        signal: signal ?? (resource === 'stream' ? AbortSignal.timeout(attempt === 0 ? STREAM_FETCH_TIMEOUT_MS : STREAM_RETRY_TIMEOUT_MS) : undefined),
      });
      statusCode = response.status;
      body = await response.text();
    } catch {
      statusCode = 0;
      body = null;
    }
    result = await coreParseAndPlanAddonResource(
      resource,
      url,
      statusCode,
      body,
      typeof kind === 'string' ? kind : '',
      typeof addonName === 'string' ? addonName : null,
      typeof season === 'number' ? season : null,
    );
    // Only network_error (bad/missing HTTP response) and parse_error (malformed body,
    // e.g. truncated JSON) indicate a transport failure worth retrying. "empty" is a
    // legitimate 2xx response with no results and must not be treated as a failure.
    if (result.kind !== 'network_error' && result.kind !== 'parse_error') break;
  }
  if (!result || result.kind === 'success') return { value: result?.kind === 'success' ? result.value : null, failed: false };
  return { value: null, failed: result.kind === 'network_error' || result.kind === 'parse_error' };
}

export async function fetchParsedAddonResource(
  url: string,
  resource: string,
  kind: unknown,
  addonName?: unknown,
  season?: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  return (await fetchAddonResourceOutcome(url, resource, kind, addonName, season, signal)).value;
}

export async function fetchPlannedResources(
  request: Record<string, unknown>,
  onPartialResult?: (result: unknown) => void,
  signal?: AbortSignal,
  onAddonFailed?: (addonName: string) => void,
): Promise<unknown[]> {
  const plan = await coreResourceFetchPlan(request);
  let requests = (plan?.requests ?? []) as FetchPlanRequest[];

  const builtinRequest = await buildBuiltinRequest(request);
  if (builtinRequest) {
    const prefs = await loadPrefs();
    requests = prefs.tmdbPreferOverAddons ? [builtinRequest, ...requests] : [...requests, builtinRequest];
  }

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
          if (isBuiltinRequest(item)) {
            const parsed = await item.__builtinResolve();
            if (!isNonEmpty(parsed)) throw new Error('empty');
            return parsed;
          }
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
    if (isBuiltinRequest(item)) {
      try {
        const value = await item.__builtinResolve();
        if (value) {
          values.push(value);
          onPartialResult?.(value);
        }
      } catch {
        // tolerate builtin failures the same as a real addon failure
      }
      return;
    }
    const url = typeof item.url === 'string' ? item.url : '';
    if (!url) return;
    try {
      const outcome = await fetchAddonResourceOutcome(
        url,
        await resourceForPlannedRequest(item.kind, request.resource, item.resource),
        item.kind,
        item.addonName,
        request.season,
        signal,
      );
      if (outcome.value) {
        values.push(outcome.value);
        onPartialResult?.(outcome.value);
      } else if (outcome.failed && typeof item.addonName === 'string' && item.addonName) {
        onAddonFailed?.(item.addonName);
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
