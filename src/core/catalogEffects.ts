import { coreSearchResultGrouping } from './engine';
import { coreResourceFetchPlan } from './addonManifest';
import { loadAddons, loadPrefs } from './libraryOps';
import { fetchPlannedResources, fetchParsedAddonResource, resourceForPlannedRequest } from './fetchPlanning';
import { discoverCatalogOptions } from './homeEffects';
import { fetchBuiltinCatalog, isBuiltinTmdbAddon } from './tmdbAddon';

export async function fetchCatalogPage(payload: Record<string, unknown>): Promise<unknown> {
  const values = await fetchPlannedResources({ ...payload, kind: 'catalogPage' });
  const items = values.flatMap((value) => ((value as { items?: unknown[] })?.items ?? []));
  return { items };
}

const searchResultsCache = new Map<string, unknown>();
let searchAbortController: AbortController | null = null;

let _searchPartialHandler: ((query: string, items: unknown[]) => void) | null = null;

export function setSearchPartialHandler(fn: ((query: string, items: unknown[]) => void) | null) {
  _searchPartialHandler = fn;
}

export async function runSearch(payload: Record<string, unknown>): Promise<unknown> {
  const query = payload.query as string;
  const language = payload.language as string | undefined;
  const cacheKey = `${language ?? ''}|${query}`;
  const cached = searchResultsCache.get(cacheKey);
  if (cached) return cached;

  searchAbortController?.abort();
  const abortController = new AbortController();
  searchAbortController = abortController;

  const addons = await loadAddons();
  const plan = await coreResourceFetchPlan({ kind: 'search', query, addons });
  const categories: Array<{
    id: string;
    name: string;
    semanticName: string;
    type: string;
    items: unknown[];
    addonName?: string;
    catalogId?: string;
  }> = [];
  const results: unknown[] = [];

  await Promise.all((plan?.requests ?? []).map(async (request) => {
    const url = typeof request.url === 'string' ? request.url : '';
    if (!url) return;
    const parsed = await fetchParsedAddonResource(
      url,
      await resourceForPlannedRequest(request.kind, undefined, request.resource),
      request.kind,
      request.addonName,
      undefined,
      abortController.signal,
    );
    const items = ((parsed?.items as unknown[] | undefined) ?? []);
    if (!items.length) return;
    results.push(...items);
    if (searchAbortController === abortController) _searchPartialHandler?.(query, items);
    categories.push({
      id: String(request.categoryId ?? url),
      name: String(request.categoryName ?? request.addonName ?? 'Search results'),
      semanticName: String(request.categoryName ?? request.addonName ?? 'Search results'),
      type: String(request.catalogType ?? 'mixed'),
      items,
      addonName: typeof request.addonName === 'string' ? request.addonName : undefined,
      catalogId: typeof request.catalogId === 'string' ? request.catalogId : undefined,
    });
  }));

  const prefs = await loadPrefs();
  const tmdbApiKey = String(prefs.tmdbApiKey ?? '').trim();
  if (tmdbApiKey) {
    await Promise.all((['movie', 'series'] as const).map(async (type) => {
      const { metas } = await fetchBuiltinCatalog(type, { search: query }, tmdbApiKey, String(prefs.language ?? 'en'));
      if (searchAbortController !== abortController || !metas.length) return;
      results.push(...metas);
      _searchPartialHandler?.(query, metas);
      categories.push({
        id: `tmdb:${type}`,
        name: 'TMDB',
        semanticName: 'TMDB',
        type,
        items: metas,
        addonName: 'TMDB',
      });
    }));
  }

  const grouping = await coreSearchResultGrouping({ query, results });
  const value = { results, categories, grouping };
  if (searchAbortController === abortController) searchResultsCache.set(cacheKey, value);
  return value;
}

let discoverAbortController: AbortController | null = null;

export async function runDiscover(payload: Record<string, unknown>): Promise<unknown> {
  discoverAbortController?.abort();
  const abortController = new AbortController();
  discoverAbortController = abortController;

  const contentType = payload.contentType as string;
  const filters = payload.filters as { catalogKey?: string; transportUrl?: string; extra?: Record<string, unknown> } | undefined;
  const extra = filters?.extra ?? {};

  if (isBuiltinTmdbAddon(filters?.transportUrl)) {
    const prefs = await loadPrefs();
    const { metas } = await fetchBuiltinCatalog(contentType, extra, String(prefs.tmdbApiKey ?? ''), String(prefs.language ?? 'en'));
    if (discoverAbortController !== abortController) throw new DOMException('superseded', 'AbortError');
    return { results: metas };
  }

  const catalogKey = filters?.catalogKey;
  const addons = await loadAddons();
  const values = await fetchPlannedResources(
    { kind: 'discover', contentType, catalogKey, extra, addons },
    undefined,
    abortController.signal,
  );
  if (discoverAbortController !== abortController) throw new DOMException('superseded', 'AbortError');

  const results = values.flatMap((value) => ((value as { items?: unknown[] })?.items ?? []));
  if (discoverAbortController !== abortController) throw new DOMException('superseded', 'AbortError');
  return { results };
}

export async function readDiscoverCatalogFilters(payload: Record<string, unknown>): Promise<unknown> {
  const contentType = payload.contentType as string;
  const addons = await loadAddons();
  const catalogOptions = await discoverCatalogOptions(addons, contentType);
  const catalogs = catalogOptions.map((catalog) => ({
    key: catalog.key,
    label: catalog.label,
    transportUrl: catalog.transportUrl,
    type: catalog.type,
    id: catalog.id,
    extras: catalog.extras ?? [],
  }));
  return { catalogs };
}
