import { platformFetch } from './httpClient';

const STREMIO_API = 'https://api.strem.io';

export interface StremioAuth {
  authKey: string;
  user: { _id?: string; email?: string };
}

export class StremioApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'StremioApiError';
    this.code = code;
  }
}

async function stremioPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await platformFetch(`${STREMIO_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new StremioApiError(`Stremio API ${res.status}`, res.status);
  }
  const data = await res.json() as { result?: T; error?: { message?: string; code?: number } };
  if (data.error) {
    throw new StremioApiError(data.error.message ?? 'Stremio request failed', data.error.code);
  }
  if (data.result == null) {
    throw new StremioApiError('Stremio request returned no result');
  }
  return data.result;
}

export async function stremioLogin(email: string, password: string): Promise<StremioAuth> {
  const result = await stremioPost<{ authKey?: string; user?: { _id?: string; email?: string; authKey?: string } }>(
    '/api/login',
    { email, password },
  );
  const authKey = result.authKey ?? result.user?.authKey;
  if (!authKey) throw new StremioApiError('Stremio login returned no auth key');
  return { authKey, user: { _id: result.user?._id, email: result.user?.email ?? email } };
}

export async function stremioLoginWithAuthKey(authKey: string): Promise<StremioAuth> {
  const user = await stremioPost<{ _id?: string; email?: string }>('/api/getUser', { authKey });
  if (!user._id) throw new StremioApiError('Stremio auth key is invalid or expired');
  return { authKey, user: { _id: user._id, email: user.email } };
}

export async function stremioLogout(authKey: string): Promise<void> {
  await stremioPost('/api/logout', { authKey }).catch(() => undefined);
}

export async function stremioPullLibrary(authKey: string): Promise<Record<string, unknown>[]> {
  const result = await stremioPost<Record<string, unknown>[]>('/api/datastoreGet', {
    authKey,
    collection: 'libraryItem',
    ids: [],
    all: true,
  });
  return Array.isArray(result) ? result : [];
}
