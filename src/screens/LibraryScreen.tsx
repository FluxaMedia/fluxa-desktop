import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { VirtualizedPosterGrid } from '../components/VirtualizedPosterGrid';
import { FilterDropdown } from '../components/FilterDropdown';
import { posterPrefsFromState } from '../core/posterPrefs';
import { appPrefs, prefString } from '../core/appPrefs';
import { effectiveCatalogId, exportCollectionsJson, importCollectionsJson } from '../core/collections';
import { saveProfile } from '../core/profiles';
import type { AppState, HomeCategory, LibraryItem, Meta, UserCollection, UserCollectionFolder, UserProfile } from '../core/types';
import { t } from '../i18n';
import { CategoryGridScreen } from './CategoryGridScreen';
import { CollectionEditorScreen } from './CollectionEditorScreen';
import { CollectionsTab } from '../components/library/CollectionsTab';

type Tab = 'watchlist' | 'watching' | 'completed' | 'dropped' | 'collections';

const NAV_RAIL_WIDTH = 104;
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
  const [tab, setTab] = useState<Tab>('watchlist');
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'rating'>('recent');
  const [viewAllFolder, setViewAllFolder] = useState<{ title: string; items: Meta[] } | null>(null);
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

  function getItemsForFolder(folder: UserCollectionFolder): Meta[] {
    const catId = effectiveCatalogId(folder);
    if (!catId) return [];
    const cat = homeCategories.find((c) => c.id === catId || c.catalogId === catId);
    if (!cat) return [];
    if (!folder.genre) return cat.items;
    return cat.items.filter((m) => m.genres?.some((g) => g.toLowerCase() === folder.genre!.toLowerCase()));
  }

  async function saveCollections(next: UserCollection[]) {
    if (!activeProfile) return;
    const updated: UserProfile = { ...activeProfile, libraryCollections: next };
    await saveProfile(updated);
    onProfileUpdated?.(updated);
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
    const imported = importCollectionsJson(json);
    if (!imported.length) return;
    const existingIds = new Set(collections.map((c) => c.id));
    const merged = [...collections, ...imported.filter((c) => !existingIds.has(c.id))];
    await saveCollections(merged);
    setEditingCollection(null);
  }

  function handleExportAll() {
    const json = exportCollectionsJson(collections);
    void navigator.clipboard.writeText(json);
  }

  if (viewAllFolder) {
    return (
      <CategoryGridScreen
        title={viewAllFolder.title}
        items={viewAllFolder.items}
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
      <div style={{ position: 'relative', height: '100%', paddingLeft: NAV_RAIL_WIDTH, background: '#040508', boxSizing: 'border-box' }}>
        <CollectionEditorScreen
          accent={accent}
          initial={initial}
          allCollections={collections}
          catalogOptions={homeCategories}
          onDismiss={() => setEditingCollection(null)}
          onSave={(c) => void handleSaveCollection(c)}
          onImportJson={(json) => void handleImportJson(json)}
          onExportAll={handleExportAll}
        />
      </div>
    );
  }

  const items = tab === 'watchlist' ? watchlist : tab === 'watching' ? watching : tab === 'completed' ? completed : tab === 'dropped' ? dropped : [];

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
    : t('library.subtitle_collections');

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
        <TabChip active={tab === 'watchlist'} onClick={() => setTab('watchlist')}>
          {t('library.plan_to_watch')}{watchlist.length > 0 ? ` (${watchlist.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'watching'} onClick={() => setTab('watching')}>
          {t('library.watching')}{watching.length > 0 ? ` (${watching.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'completed'} onClick={() => setTab('completed')}>
          {t('library.completed')}{completed.length > 0 ? ` (${completed.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'dropped'} onClick={() => setTab('dropped')}>
          {t('library.dropped')}{dropped.length > 0 ? ` (${dropped.length})` : ''}
        </TabChip>
        <TabChip active={tab === 'collections'} onClick={() => setTab('collections')}>
          {t('library.collections')}{collections.length > 0 ? ` (${collections.length})` : ''}
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
              onSelect={(v) => setSortBy(v as 'recent' | 'title' | 'rating')}
            />
          </div>
        )}
      </div>

      <div style={{ height: 8 }} />

      {tab === 'collections' ? (
        <div ref={collectionsScrollRef} style={styles.collectionsScroll}>
          <CollectionsTab
            collections={collections}
            accent={accent}
            onFolderClick={(folder, folderTitle) => {
              savedScrollRef.current = collectionsScrollRef.current?.scrollTop ?? 0;
              setViewAllFolder({ title: folderTitle, items: getItemsForFolder(folder) });
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
              : t('library.nothing_dropped')}
          </p>
          <p style={styles.emptyHint}>
            {tab === 'watchlist' ? t('library.add_titles_hint')
              : tab === 'watching' ? t('library.start_watching_hint')
              : tab === 'completed' ? t('library.completed_hint')
              : t('library.dropped_hint')}
          </p>
        </div>
      ) : sorted.length === 0 ? (
        <div style={styles.empty}>
          <p style={styles.emptyTitle}>{t('library.no_matches')}</p>
        </div>
      ) : (
        <VirtualizedPosterGrid
          items={sorted as unknown as Meta[]}
          selectedId={null}
          posterPrefs={posterPrefs}
          onHover={() => false}
          onClick={onNavigateDetail}
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
        border: 'none', borderRadius: 20, padding: '8px 20px',
        fontSize: 14, fontWeight: 700, cursor: 'pointer',
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
  screen: { background: '#040508', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', paddingLeft: NAV_RAIL_WIDTH },
  header: { display: 'flex', alignItems: 'center', gap: 24, padding: '40px 58px', flexShrink: 0 },
  controls: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 },
  searchWrap: {
    display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 12px', width: 220,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
  },
  searchInput: {
    flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
    color: '#fff', fontSize: 13, fontWeight: 600,
  },
  collectionsScroll: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 80 },
  title: { color: '#FFFFFF', fontSize: 32, fontWeight: 900, margin: '0 0 4px', letterSpacing: '2px' },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 14, margin: 0, lineHeight: 1.4 },
  tabRow: { display: 'flex', alignItems: 'center', gap: 10, paddingLeft: PX, paddingRight: PX, flexShrink: 0 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: 700, margin: 0 },
  emptyHint: { color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0, textAlign: 'center', maxWidth: 320, lineHeight: 1.5 },
};
