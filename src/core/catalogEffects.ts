import { coreDiscoverSortPlan, coreSearchResultGrouping } from './engine';
import { coreResourceFetchPlan } from './addonManifest';
import { loadAddons } from './libraryOps';
import { fetchPlannedResources, fetchParsedAddonResource, resourceForPlannedRequest } from './fetchPlanning';
import { discoverCatalogOptions } from './homeEffects';

export async function fetchCatalogPage(payload: Record<string, unknown>): Promise<unknown> {
  const values = await fetchPlannedResources({ ...payload, kind: 'catalogPage' });
  const metas = values.flatMap((value) => ((value as { items?: unknown[] })?.items ?? []));
  return { metas };
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

  const grouping = await coreSearchResultGrouping({ query, results });
  const value = { results, categories, grouping };
  if (searchAbortController === abortController) searchResultsCache.set(cacheKey, value);
  return value;
}

let _discoverPartialHandler: ((items: unknown[]) => void) | null = null;

export function setDiscoverPartialHandler(fn: ((items: unknown[]) => void) | null) {
  _discoverPartialHandler = fn;
}

let discoverAbortController: AbortController | null = null;

export async function runDiscover(payload: Record<string, unknown>): Promise<unknown> {
  discoverAbortController?.abort();
  const abortController = new AbortController();
  discoverAbortController = abortController;

  const contentType = payload.contentType as string;
  const filters = payload.filters as Record<string, string> | undefined;
  const genre = (payload.genre as string | null | undefined) ?? filters?.genre;
  const sortBy = payload.sortBy as string | undefined;
  const addons = await loadAddons();
  const values = await fetchPlannedResources(
    { kind: 'discover', contentType, genre, addons },
    (partial) => {
      if (discoverAbortController !== abortController) return;
      const items = (partial as { items?: unknown[] })?.items ?? [];
      if (items.length > 0) _discoverPartialHandler?.(items);
    },
    abortController.signal,
  );
  const results = values.flatMap((value) => ((value as { items?: unknown[] })?.items ?? []));
  // Dedup before sending to Rust, not just after: with enough addons installed, raw
  // results before dedup can run into the megabytes — sending that whole blob as IPC
  // input costs as much as returning it would, even though the final output is capped.
  const seenIds = new Set<string>();
  const dedupedResults = results.filter((item) => {
    const id = (item as { id?: string }).id;
    if (!id) return true;
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });

  const coreSort = await coreDiscoverSortPlan({
    items: dedupedResults,
    sortBy: sortBy ?? 'default',
    ascending: false,
    contentTypeFilter: contentType,
    genreFilter: genre,
  }) as { items?: unknown[] } | null;

  return { results: coreSort?.items ?? dedupedResults };
}

export async function readDiscoverCatalogFilters(payload: Record<string, unknown>): Promise<unknown> {
  const contentType = payload.contentType as string;
  const addons = await loadAddons();
  const catalogOptions = await discoverCatalogOptions(addons, contentType);
  const catalogs = catalogOptions.map((catalog) => ({
    key: catalog.key,
    name: catalog.label,
    addonName: catalog.label,
    transportUrl: catalog.transportUrl,
    type: catalog.type,
    id: catalog.id,
    genres: catalog.genres ?? [],
    requiresGenre: catalog.requiresGenre ?? false,
  }));
  return { catalogs };
}
