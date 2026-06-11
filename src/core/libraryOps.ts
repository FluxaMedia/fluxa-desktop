import {
  coreBuildContinueWatchingFromProgress,
  coreNormalizeLibraryDocument,
  storageRead,
  storageWrite,
} from './engine';
import { normalizeAddonDescriptor } from './addons';
import type { AddonDescriptor, UserProfile } from './types';

let _cachedLibraryKey: string | null = null;

export function invalidateLibraryKeyCache(): void {
  _cachedLibraryKey = null;
}

async function activeProfileStorageSuffix(): Promise<string> {
  const profileId = (await storageRead<string>('active_profile_id'))?.trim();
  return profileId ? profileId.replace(/[^a-zA-Z0-9_-]/g, '_') : 'guest';
}

export async function effectRunnerLibraryKey(): Promise<string> {
  if (_cachedLibraryKey) return _cachedLibraryKey;
  _cachedLibraryKey = `library_${await activeProfileStorageSuffix()}`;
  return _cachedLibraryKey;
}

export async function addonsStorageKey(): Promise<string> {
  return `addons_${await activeProfileStorageSuffix()}`;
}

export async function loadAddons(): Promise<AddonDescriptor[]> {
  return ((await storageRead<AddonDescriptor[]>(await addonsStorageKey())) ?? []).map(normalizeAddonDescriptor);
}

export async function saveAddons(addons: AddonDescriptor[]): Promise<void> {
  await storageWrite(await addonsStorageKey(), addons);
}

export async function normalizeLibraryDoc(lib: Record<string, unknown>): Promise<Record<string, unknown>> {
  return coreNormalizeLibraryDocument(JSON.stringify(lib));
}

export async function loadLibrary(): Promise<Record<string, unknown>> {
  const key = await effectRunnerLibraryKey();
  const profileLibrary = await storageRead<Record<string, unknown>>(key);
  if (profileLibrary) return normalizeLibraryDoc(profileLibrary);
  const legacyLibrary = await storageRead<Record<string, unknown>>('library');
  if (legacyLibrary) {
    const migrated = await normalizeLibraryDoc({ ...legacyLibrary, migratedFrom: 'library' });
    await storageWrite(key, migrated);
    return migrated;
  }
  return normalizeLibraryDoc({});
}

export async function saveLibrary(lib: Record<string, unknown>): Promise<void> {
  await storageWrite(await effectRunnerLibraryKey(), await normalizeLibraryDoc(lib));
}

export async function loadPrefs(): Promise<Record<string, unknown>> {
  return (await storageRead<Record<string, unknown>>('prefs')) ?? {};
}

export async function loadActiveProfile(): Promise<UserProfile | null> {
  const profileId = await storageRead<string>('active_profile_id');
  if (!profileId) return null;
  const profiles = (await storageRead<UserProfile[]>('profiles')) ?? [];
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

export async function buildContinueWatching(progressMap: Record<string, unknown>): Promise<unknown[]> {
  return (await coreBuildContinueWatchingFromProgress(JSON.stringify(progressMap))) ?? [];
}
