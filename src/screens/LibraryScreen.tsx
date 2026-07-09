import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckSquare2, Search, Square, X } from 'lucide-react';
import { VirtualizedPosterGrid } from '../components/VirtualizedPosterGrid';
import { FilterDropdown } from '../components/FilterDropdown';
import { posterPrefsFromState } from '../core/posterPrefs';
import { appPrefs, prefString } from '../core/appPrefs';
import { effectiveCatalogId, effectiveCatalogType, exportCollectionsJson, importCollectionsJson } from '../core/collections';
import { getViewPrefs, setViewPref, whenViewPrefsReady } from '../core/viewPrefs';
import { saveProfile } from '../core/profiles';
import { nuvioPushCollections } from '../core/nuvioApi';
import { freshNuvioProfile } from '../core/nuvioSync';
import type { AppState, HomeCategory, LibraryItem, Meta, UserCollection, UserCollectionFolder, UserProfile } from '../core/types';
import { t } from '../i18n';
import { CategoryGridScreen } from './CategoryGridScreen';
import { CollectionEditorScreen } from './CollectionEditorScreen';
import { CollectionsTab } from '../components/library/CollectionsTab';

type Tab = 'watchlist' | 'watching' | 'completed' | 'dropped' | 'collections' | 'airing' | 'rated' | 'history';

const NAV_RAIL_WIDTH = 6.5;
const PX = 58;

interface Props {
  state: AppState;
  onDispatch: (actionJson: string) => void;
  onNavigateDetail: (meta: Meta) => void;
  onBack: () => void;
  activeProfile?: UserProfile | null;
  onProfileUpdated?: (profile: UserProfile) => void;
}

export const LibraryScreen = React.memo(function LibraryScreen({
  state,
  onDispatch,
  onNavigateDetail,
  onBack,
  activeProfile,
  onProfileUpdated,
}: Props) {
  const [tab, setTab] = useState<Tab>(() => (getViewPrefs().libraryTab as Tab) ?? 'watchlist');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'rating'>(() => (getViewPrefs().librarySort as 'recent' | 'title' | 'rating') ?? 'recent');
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void whenViewPrefsReady().then(() => {
      const v = getViewPrefs();
      if (v.libraryTab) setTab(v.libraryTab as Tab);
      if (v.librarySort) setSortBy(v.librarySort as 'recent' | 'title' | 'rating');
    });
  }, []);

  const changeTab = (v: Tab) => { setTab(v); setViewPref('libraryTab', v); };
  const changeSort = (v: 'recent' | 'title' | 'rating') => { setSortBy(v); setViewPref('librarySort', v); };
  const [viewAllFolder, setViewAllFolder] = useState<{ title: string; items: Meta[]; groups: Array<{ type: string; items: Meta[] }> } | null>(null);
  const collectionsScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);

  useLayoutEffect(() => {
    if (!viewAllFolder && collectionsScrollRef.current) collectionsScrollRef.current.scrollTop = savedScrollRef.current;
  }, [viewAllFolder]);
  const [editingCollection, setEditingCollection] = useState<UserCollection | 'new' | null>(null);
  const library = state.library;

  useEffect(() => {
    if (!state.library?.watchlist && !state.library?.isLoading) {
      onDispatch(JSON.stringify({ type: 'libraryHydrateRequested' }));
    }
  }, []);

  const watchlist = (library.lastWrite?.watchlist ?? library.watchlist ?? []) as LibraryItem[];
  const watching = (library.lastWrite?.continueWatching ?? library.continueWatching ?? []) as LibraryItem[];
  const rawCompleted = (library.lastWrite?.completed ?? library.completed ?? []) as LibraryItem[];
  const rawDropped = (library.lastWrite?.dropped ?? library.dropped ?? []) as LibraryItem[];
  const progressItems = Object.values((library.lastWrite?.progress ?? {}) as Record<string, LibraryItem>);
  const completed = useMemo(
    () => [...rawCompleted].sort((a, b) => (b.statusChangedAt ?? '').localeCompare(a.statusChangedAt ?? '')),
    [rawCompleted]
  );
  const dropped = useMemo(
    () => [...rawDropped].sort((a, b) => (b.statusChangedAt ?? '').localeCompare(a.statusChangedAt ?? '')),
    [rawDropped]
  );
  const posterPrefs = useMemo(() => posterPrefsFromState(state), [state.settings?.values]);
  const prefs = useMemo(() => appPrefs(state), [state.settings?.values]);
  const accent = prefString(prefs, 'accentColorArgb', '#FFFFFF');

  const collections: UserCollection[] = activeProfile?.libraryCollections ?? [];
  const homeCategories: HomeCategory[] = state.home.categories ?? [];

  function getItemsForFolder(folder: UserCollectionFolder): { items: Meta[]; groups: Array<{ type: string; items: Meta[] }> } {
    const sources = folder.catalogSources?.length
      ? folder.catalogSources
      : effectiveCatalogId(folder)
        ? [{ catalogId: effectiveCatalogId(folder)!, type: effectiveCatalogType(folder) ?? '' }]
        : [];
    const groupsByType = new Map<string, Meta[]>();
    for (const source of sources) {
      const cat = homeCategories.find((c) => c.id === source.catalogId || c.catalogId === source.catalogId);
      if (!cat) continue;
      const items = folder.genre
        ? cat.items.filter((m) => m.genres?.some((g) => g.toLowerCase() === folder.genre!.toLowerCase()))
        : cat.items;
      const existing = groupsByType.get(source.type);
      if (existing) existing.push(...items);
      else groupsByType.set(source.type, [...items]);
    }
    const groups = Array.from(groupsByType, ([type, items]) => ({ type, items }));
    return { items: groups.flatMap((g) => g.items), groups };
  }

  async function saveCollections(next: UserCollection[]) {
    if (!activeProfile) return;
    const updated: UserProfile = { ...activeProfile, libraryCollections: next };
    await saveProfile(updated);
    onProfileUpdated?.(updated);
    if (!updated.nuvioAccessToken) return;

    // Keep the local save responsive and durable even when Nuvio is unavailable.
    try {
      const freshProfile = await freshNuvioProfile(updated);
      const token = freshProfile.nuvioAccessToken;
      if (!token) return;
      await nuvioPushCollections(token, freshProfile.nuvioProfileIndex ?? 1, next);
      if (freshProfile !== updated) onProfileUpdated?.(freshProfile);
    } catch {
      // Keep the local collection intact when the remote write cannot complete.
    }
  }

  async function handleSaveCollection(col: UserCollection) {
    const existing = collections.findIndex((c) => c.id === col.id);
    const next = existing >= 0
      ? collections.map((c) => (c.id === col.id ? col : c))
      : [...collections, col];
    await saveCollections(next);
    setEditingCollection(null);
  }

  async function handleDeleteCollection(id: string) {
    await saveCollections(collections.filter((c) => c.id !== id));
  }

  async function handleImportJson(json: string) {
    const imported = await importCollectionsJson(json);
    if (!imported.length) return;
    const existingIds = new Set(collections.map((c) => c.id));
    const merged = [...collections, ...imported.filter((c) => !existingIds.has(c.id))];
    await saveCollections(merged);
    setEditingCollection(null);
  }

  async function handleExportAll() {
    const json = await exportCollectionsJson(collections);
    await navigator.clipboard.writeText(json);
  }

  if (viewAllFolder) {
    return (
      <CategoryGridScreen
        title={viewAllFolder.title}
        items={viewAllFolder.items}
        groups={viewAllFolder.groups}
        posterPrefs={posterPrefs}
        onNavigateDetail={onNavigateDetail}
        onBack={() => setViewAllFolder(null)}
        onDispatch={onDispatch}
      />
    );
  }

  if (editingCollection !== null) {
    const initial = editingCollection === 'new' ? null : editingCollection;
    return (
      <div style={{ position: 'relative', height: '100%', paddingLeft: `${NAV_RAIL_WIDTH}rem`, background: '#040508', boxSizing: 'border-box' }}>
        <CollectionEditorScreen
          accent={accent}
          initial={initial}
          allCollections={collections}
          catalogOptions={homeCategories}
          onDismiss={() => setEditingCollection(null)}
          onSave={(c) => void handleSaveCollection(c)}
          onImportJson={(json) => void handleImportJson(json)}
          onExportAll={() => void handleExportAll()}
        />
      </div>
    );
  }

  const smartLists = useMemo(() => {
    const all = uniqueLibraryItems([...watchlist, ...watching, ...completed, ...dropped, ...progressItems]);
    const airing = uniqueLibraryItems([...watching, ...watchlist])
      .filter((item) => Boolean(item.nextEpisodeAirDate || item.newEpisodeReleasedAt || item.continueWatchingBadge === 'newEpisode' || item.continueWatchingBadge === 'scheduledEpisode'))
      .sort((a, b) => itemAirTime(a) - itemAirTime(b));
    const rated = [...all]
      .filter((item) => Number((item as unknown as Meta).imdbRating ?? 0) >= 7.5)
      .sort((a, b) => Number((b as unknown as Meta).imdbRating ?? 0) - Number((a as unknown as Meta).imdbRating ?? 0));
    const history = [...all]
      .filter((item) => itemActivityTime(item) > 0)
      .sort((a, b) => itemActivityTime(b) - itemActivityTime(a));
    return { airing, rated, history };
  }, [watchlist, watching, completed, dropped, progressItems]);

  const items = tab === 'watchlist' ? watchlist
    : tab === 'watching' ? watching
    : tab === 'completed' ? completed
    : tab === 'dropped' ? dropped
    : tab === 'airing' ? smartLists.airing
    : tab === 'rated' ? smartLists.rated
    : tab === 'history' ? smartLists.history
    : [];

  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const visibleIds = new Set(items.map((item) => item.id));
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items;
  const sorted = sortBy === 'title'
    ? [...shown].sort((a, b) => a.name.localeCompare(b.name))
    : sortBy === 'rating'
    ? [...shown].sort((a, b) => Number((b as Meta).imdbRating ?? 0) - Number((a as Meta).imdbRating ?? 0) || a.name.localeCompare(b.name))
    : shown;

  const subtitle = tab === 'watchlist' ? t('auto.movies_and_shows_you_saved_to_watch_later')
    : tab === 'watching' ? t('library.subtitle_watching')
    : tab === 'completed' ? t('library.subtitle_completed')
    : tab === 'dropped' ? t('library.subtitle_dropped')
    : tab === 'airing' ? t('library.subtitle_airing')
    : tab === 'rated' ? t('library.subtitle_rated')
    : tab === 'history' ? t('library.subtitle_history')
    : t('library.subtitle_collections');

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds],
  );
  const canRemoveFromCurrentList = tab === 'watchlist' || tab === 'completed' || tab === 'dropped';
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const runForSelected = async (buildAction: (item: LibraryItem) => Record<string, unknown> | null) => {
    const batch = [...selectedItems];
    clearSelection();
    for (const item of batch) {
      const action = buildAction(item);
      if (action) await Promise.resolve(onDispatch(JSON.stringify(action)));
    }
  };
  const markSelectedWatched = (watched: boolean) => {
    void runForSelected((item) => ({
      type: 'markWatchedRequested',
      seriesId: item.id,
      videoIds: [item.lastVideoId ?? item.id],
      watched,
      meta: item,
      episodes: item.lastVideoId ? [{
        id: item.lastVideoId,
        name: item.lastEpisodeName,
        season: item.lastEpisodeSeason,
        number: item.lastEpisodeNumber,
        thumbnail: item.lastEpisodeThumbnail,
      }] : [],
    }));
  };
  const moveSelectedToStatus = (list: 'completed' | 'dropped') => {
    const existingIds = new Set((list === 'completed' ? completed : dropped).map((item) => item.id));
    void runForSelected((item) => existingIds.has(item.id) ? null : ({
      type: 'toggleLibraryStatusRequested',
      list,
      item,
    }));
  };
  const removeSelectedFromCurrentList = () => {
    if (!canRemoveFromCurrentList) return;
    void runForSelected((item) => tab === 'watchlist'
      ? { type: 'toggleWatchlistRequested', item }
      : { type: 'toggleLibraryStatusRequested', list: tab, item });
  };

  return (
    <div style={styles.screen}>
      <div style={styles.header}>
        <CircleBtn onClick={onBack} size={48}>
          <ArrowLeft size={24} color="#fff" />
        </CircleBtn>
        <div>
          <p style={styles.title}>{t('auto.my_library_a6c93797')}</p>
          <p style={styles.subtitle}>{subtitle}</p>
        </div>
      </div>

      <div style={styles.tabRow}>
        <TabChip active={tab === 'watchlist'} onClick={() => changeTab('watchlist')}>
          {t('library.plan_to_watch')}{watchlist.length > 0 ? ` (${watchlist.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'watching'} onClick={() => changeTab('watching')}>
          {t('library.watching')}{watching.length > 0 ? ` (${watching.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'completed'} onClick={() => changeTab('completed')}>
          {t('library.completed')}{completed.length > 0 ? ` (${completed.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'dropped'} onClick={() => changeTab('dropped')}>
          {t('library.dropped')}{dropped.length > 0 ? ` (${dropped.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'collections'} onClick={() => changeTab('collections')}>
          {t('library.collections')}{collections.length > 0 ? ` (${collections.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'airing'} onClick={() => changeTab('airing')}>
          {t('library.smart_airing')}{smartLists.airing.length > 0 ? ` (${smartLists.airing.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'rated'} onClick={() => changeTab('rated')}>
          {t('library.smart_rated')}{smartLists.rated.length > 0 ? ` (${smartLists.rated.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'history'} onClick={() => changeTab('history')}>
          {t('library.history')}{smartLists.history.length > 0 ? ` (${smartLists.history.length})` : ''}
        </TabChip>
        {tab !== 'collections' && (
          <div style={styles.controls}>
            <div style={styles.searchWrap}>
              <Search size={15} style={{ color: 'rgba(255,255,255,0.35)', flexShrink: 0 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('library.filter_placeholder')}
                style={styles.searchInput}
              />
            </div>
            <FilterDropdown
              value={sortBy === 'recent' ? t('library.sort_recent') : t('library.sort_title')}
              options={[
                { value: 'recent', label: t('library.sort_recent') },
                { value: 'title', label: t('library.sort_title') },
                { value: 'rating', label: t('library.sort_rating') },
              ]}
              onSelect={(v) => changeSort(v as 'recent' | 'title' | 'rating')}
            />
            <button
              style={{ ...styles.bulkToggle, background: bulkMode ? '#FFFFFF' : 'rgba(255,255,255,0.05)', color: bulkMode ? '#000' : '#fff' }}
              onClick={() => {
                setBulkMode((v) => !v);
                clearSelection();
              }}
            >
              {bulkMode ? <CheckSquare2 size={15} /> : <Square size={15} />}
              <span>{t('library.bulk_select')}</span>
            </button>
          </div>
        )}
      </div>

      {bulkMode && tab !== 'collections' && (
        <div style={styles.bulkBar}>
          <button style={styles.bulkGhostBtn} onClick={() => {
            if (selectedIds.size === sorted.length) clearSelection();
            else setSelectedIds(new Set(sorted.map((item) => item.id)));
          }}>
            {selectedIds.size === sorted.length ? t('library.clear_selection') : t('library.select_all')}
          </button>
          <span style={styles.bulkCount}>{t('library.selected_count', selectedIds.size)}</span>
          <div style={{ flex: 1 }} />
          <button style={styles.bulkBtn} disabled={selectedIds.size === 0} onClick={() => markSelectedWatched(true)}>{t('detail.mark_watched')}</button>
          <button style={styles.bulkBtn} disabled={selectedIds.size === 0} onClick={() => markSelectedWatched(false)}>{t('detail.mark_unwatched')}</button>
          <button style={styles.bulkBtn} disabled={selectedIds.size === 0} onClick={() => moveSelectedToStatus('completed')}>{t('library.mark_completed')}</button>
          <button style={styles.bulkBtn} disabled={selectedIds.size === 0} onClick={() => moveSelectedToStatus('dropped')}>{t('library.mark_dropped')}</button>
          {canRemoveFromCurrentList && (
            <button style={styles.bulkDangerBtn} disabled={selectedIds.size === 0} onClick={removeSelectedFromCurrentList}>{t('common.remove')}</button>
          )}
          <button style={styles.bulkIconBtn} onClick={() => { setBulkMode(false); clearSelection(); }} title={t('common.close')}><X size={17} /></button>
        </div>
      )}

      {library.lastWriteError && (
        <div style={styles.errorBanner}>
          <div style={{ minWidth: 0 }}>
            <p style={styles.errorTitle}>{t('common.error')}</p>
            <p style={styles.errorText}>{library.lastWriteError}</p>
          </div>
          <button style={styles.errorBtn} onClick={() => onDispatch(JSON.stringify({ type: 'libraryHydrateRequested' }))}>
            {t('common.retry')}
          </button>
        </div>
      )}

      <div style={{ height: '0.5rem' }} />

      {tab === 'collections' ? (
        <div ref={collectionsScrollRef} style={styles.collectionsScroll}>
          <CollectionsTab
            collections={collections}
            accent={accent}
            onFolderClick={(folder, folderTitle) => {
              savedScrollRef.current = collectionsScrollRef.current?.scrollTop ?? 0;
              setViewAllFolder({ title: folderTitle, ...getItemsForFolder(folder) });
            }}
            onEditCollection={(col) => setEditingCollection(col)}
            onDeleteCollection={(id) => void handleDeleteCollection(id)}
            onNewCollection={() => setEditingCollection('new')}
            onShowAllOnHome={() => void saveCollections(collections.map((c) => ({ ...c, showOnHome: true })))}
          />
        </div>
      ) : items.length === 0 ? (
        <div style={styles.empty}>
          <p style={styles.emptyTitle}>
            {tab === 'watchlist' ? t('library.your_list_empty')
              : tab === 'watching' ? t('library.nothing_to_continue')
              : tab === 'completed' ? t('library.nothing_completed')
              : tab === 'dropped' ? t('library.nothing_dropped')
              : tab === 'history' ? t('library.history_empty')
              : t('library.smart_empty')}
          </p>
          <p style={styles.emptyHint}>
            {tab === 'watchlist' ? t('library.add_titles_hint')
              : tab === 'watching' ? t('library.start_watching_hint')
              : tab === 'completed' ? t('library.completed_hint')
              : tab === 'dropped' ? t('library.dropped_hint')
              : tab === 'history' ? t('library.history_empty_hint')
              : t('library.smart_empty_hint')}
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div style={styles.empty}>
          <p style={styles.emptyTitle}>{t('library.no_matches')}</p>
        </div>
      ) : tab === 'history' ? (
        <HistoryTimeline items={sorted} onNavigateDetail={onNavigateDetail} />
      ) : (
        <VirtualizedPosterGrid
          items={sorted as unknown as Meta[]}
          selectedId={null}
          selectedIds={bulkMode ? selectedIds : undefined}
          posterPrefs={posterPrefs}
          onHover={() => false}
          onClick={bulkMode ? (item) => toggleSelected(item.id) : onNavigateDetail}
          onScrollActivity={() => {}}
        />
      )}
    </div>
  );
}, (prev, next) =>
  prev.state.library === next.state.library &&
  prev.state.settings === next.state.settings &&
  prev.state.home === next.state.home &&
  prev.activeProfile === next.activeProfile &&
  prev.onDispatch === next.onDispatch &&
  prev.onNavigateDetail === next.onNavigateDetail &&
  prev.onBack === next.onBack &&
  prev.onProfileUpdated === next.onProfileUpdated,
);

function uniqueLibraryItems(items: LibraryItem[]): LibraryItem[] {
  const seen = new Set<string>();
  const next: LibraryItem[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function itemActivityTime(item: LibraryItem): number {
  const raw = (item as LibraryItem & { savedAt?: string; updatedAt?: string; lastWatchedAt?: string }).savedAt
    ?? (item as LibraryItem & { savedAt?: string; updatedAt?: string; lastWatchedAt?: string }).lastWatchedAt
    ?? item.statusChangedAt
    ?? item.newEpisodeReleasedAt
    ?? item.lastAirDateCheckedAt
    ?? (item as LibraryItem & { updatedAt?: string }).updatedAt;
  const parsed = raw ? Date.parse(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemAirTime(item: LibraryItem): number {
  const raw = item.nextEpisodeAirDate ?? item.newEpisodeReleasedAt;
  const parsed = raw ? Date.parse(raw) : Number.POSITIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function HistoryTimeline({ items, onNavigateDetail }: { items: LibraryItem[]; onNavigateDetail: (meta: Meta) => void }) {
  return (
    <div style={styles.historyScroll}>
      {items.map((item) => {
        const at = itemActivityTime(item);
        const progress = (item.timeOffset ?? 0) > 0 && (item.duration ?? 0) > 0
          ? Math.min(100, Math.round(((item.timeOffset ?? 0) / (item.duration ?? 1)) * 100))
          : null;
        const label = item.statusChangedAt
          ? t('library.history_status_changed')
          : item.lastVideoId
            ? t('library.history_watched_episode', item.lastEpisodeSeason ?? 1, item.lastEpisodeNumber ?? '')
            : t('library.history_updated');
        return (
          <button key={`${item.id}:${at}`} style={styles.historyRow} onClick={() => onNavigateDetail(item as unknown as Meta)}>
            <div style={styles.historyDate}>
              <span style={styles.historyDay}>{at ? new Date(at).toLocaleDateString(undefined, { day: '2-digit' }) : '--'}</span>
              <span style={styles.historyMonth}>{at ? new Date(at).toLocaleDateString(undefined, { month: 'short' }) : ''}</span>
            </div>
            {item.poster && <img src={item.poster} alt="" style={styles.historyPoster} />}
            <div style={styles.historyInfo}>
              <p style={styles.historyTitle}>{item.name}</p>
              <p style={styles.historyMeta}>{label}</p>
              {progress != null && progress > 0 && progress < 100 && (
                <div style={styles.historyProgressTrack}>
                  <div style={{ ...styles.historyProgressFill, width: `${progress}%` }} />
                </div>
              )}
            </div>
            <span style={styles.historyTime}>{at ? new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

function CircleBtn({ onClick, size, children }: { onClick: () => void; size: number; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        width: size, height: size, minWidth: size, borderRadius: '50%',
        background: hovered ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
        border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s',
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

function TabChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      style={{
        background: active ? '#FFFFFF' : hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)',
        color: active ? '#000000' : '#FFFFFF',
        border: 'none', borderRadius: '1.25rem', padding: '0.5rem 1.25rem',
        fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer',
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
  screen: { background: '#040508', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingLeft: `${NAV_RAIL_WIDTH}rem` },
  header: { display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '2.5rem 3.625rem', flexShrink: 0 },
  controls: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.625rem' },
  bulkToggle: {
    height: '2.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4375rem',
    padding: '0 0.75rem',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '0.5rem',
    fontSize: '0.8125rem',
    fontWeight: 800,
    cursor: 'pointer',
  },
  searchWrap: {
    display: 'flex', alignItems: 'center', gap: '0.4375rem', height: '2.25rem', padding: '0 0.75rem', width: '13.75rem',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '0.5rem',
  },
  searchInput: {
    flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
    color: '#fff', fontSize: '0.8125rem', fontWeight: 600,
  },
  collectionsScroll: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '5rem' },
  title: { color: '#FFFFFF', fontSize: '2rem', fontWeight: 900, margin: '0 0 0.25rem', letterSpacing: '0.125rem' },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem', margin: 0, lineHeight: 1.4 },
  tabRow: { display: 'flex', alignItems: 'center', gap: '0.625rem', paddingLeft: PX, paddingRight: PX, flexShrink: 0, flexWrap: 'wrap' },
  bulkBar: {
    margin: '0.875rem 3.625rem 0',
    minHeight: '2.75rem',
    padding: '0.4375rem 0.5rem',
    borderRadius: '0.625rem',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.06)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexShrink: 0,
  },
  bulkCount: { color: 'rgba(255,255,255,0.62)', fontSize: '0.8125rem', fontWeight: 800 },
  bulkBtn: {
    height: '1.875rem',
    padding: '0 0.625rem',
    borderRadius: '0.4375rem',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.08)',
    color: '#FFFFFF',
    fontSize: '0.75rem',
    fontWeight: 800,
    cursor: 'pointer',
  },
  bulkDangerBtn: {
    height: '1.875rem',
    padding: '0 0.625rem',
    borderRadius: '0.4375rem',
    border: '1px solid rgba(255,80,80,0.22)',
    background: 'rgba(255,80,80,0.14)',
    color: '#FFFFFF',
    fontSize: '0.75rem',
    fontWeight: 800,
    cursor: 'pointer',
  },
  bulkGhostBtn: {
    height: '1.875rem',
    padding: '0 0.625rem',
    borderRadius: '0.4375rem',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.78)',
    fontSize: '0.75rem',
    fontWeight: 800,
    cursor: 'pointer',
  },
  bulkIconBtn: {
    width: '1.875rem',
    height: '1.875rem',
    borderRadius: '0.4375rem',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  errorBanner: {
    margin: '0.875rem 3.625rem 0',
    padding: '0.75rem 0.875rem',
    borderRadius: '0.625rem',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.055)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexShrink: 0,
  },
  errorTitle: { color: '#FFFFFF', fontSize: '0.8125rem', fontWeight: 850, margin: '0 0 0.1875rem' },
  errorText: { color: 'rgba(255,255,255,0.52)', fontSize: '0.75rem', fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  errorBtn: {
    height: '2rem',
    padding: '0 0.75rem',
    borderRadius: '62.4375rem',
    border: '1px solid rgba(255,255,255,0.14)',
    background: '#FFFFFF',
    color: '#000000',
    fontSize: '0.75rem',
    fontWeight: 850,
    cursor: 'pointer',
    flexShrink: 0,
  },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '5rem', gap: '0.625rem' },
  emptyTitle: { color: '#FFFFFF', fontSize: '1.25rem', fontWeight: 700, margin: 0 },
  emptyHint: { color: 'rgba(255,255,255,0.4)', fontSize: '0.875rem', margin: 0, textAlign: 'center', maxWidth: '20rem', lineHeight: 1.5 },
  historyScroll: { flex: 1, overflowY: 'auto', padding: '0.625rem 3.625rem 5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  historyRow: {
    width: '100%',
    minHeight: '4.75rem',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.035)',
    borderRadius: '0.625rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.625rem 0.75rem',
    cursor: 'pointer',
    textAlign: 'left',
  },
  historyDate: { width: '2.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 },
  historyDay: { color: '#FFFFFF', fontSize: '1.125rem', fontWeight: 900, lineHeight: '1.25rem' },
  historyMonth: { color: 'rgba(255,255,255,0.42)', fontSize: '0.6875rem', fontWeight: 800, textTransform: 'uppercase' },
  historyPoster: { width: '2.375rem', height: '3.5rem', objectFit: 'cover', borderRadius: '0.375rem', flexShrink: 0 },
  historyInfo: { flex: 1, minWidth: 0 },
  historyTitle: { color: '#FFFFFF', fontSize: '0.9375rem', fontWeight: 850, margin: '0 0 0.3125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  historyMeta: { color: 'rgba(255,255,255,0.48)', fontSize: '0.75rem', fontWeight: 650, margin: 0 },
  historyTime: { color: 'rgba(255,255,255,0.38)', fontSize: '0.75rem', fontWeight: 750, flexShrink: 0 },
  historyProgressTrack: { width: '10rem', maxWidth: '100%', height: '0.25rem', borderRadius: '62.4375rem', background: 'rgba(255,255,255,0.1)', marginTop: '0.5625rem', overflow: 'hidden' },
  historyProgressFill: { height: '100%', borderRadius: '62.4375rem', background: 'var(--primary-accent-color)' },
};
