import { useEffect, useState } from 'react';

type ApiConfig = {
  baseUrl: string;
  token: string;
  readOnly: boolean;
};

const API_BASE_KEY = 'cli-run-ui.apiBase';
const API_TOKEN_KEY = 'cli-run-ui.apiToken';
const API_READONLY_KEY = 'cli-run-ui.apiReadOnly';
const API_ENV_BASE = import.meta.env.VITE_API_BASE as string | undefined;

let cachedConfig = readConfig();
const listeners = new Set<() => void>();

function readConfig(): ApiConfig {
  if (typeof window === 'undefined') {
    return { baseUrl: normalizeBaseUrl(API_ENV_BASE ?? ''), token: '', readOnly: false };
  }
  const storedBase = window.localStorage.getItem(API_BASE_KEY) ?? '';
  const storedToken = window.localStorage.getItem(API_TOKEN_KEY) ?? '';
  const storedReadOnly = window.localStorage.getItem(API_READONLY_KEY) ?? '';
  return {
    baseUrl: normalizeBaseUrl(storedBase || API_ENV_BASE || ''),
    token: storedToken,
    readOnly: storedReadOnly === '1',
  };
}

function writeConfig(next: ApiConfig) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(API_BASE_KEY, next.baseUrl);
  window.localStorage.setItem(API_TOKEN_KEY, next.token);
  window.localStorage.setItem(API_READONLY_KEY, next.readOnly ? '1' : '0');
}

function emit() {
  for (const listener of listeners) listener();
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function getApiConfig(): ApiConfig {
  return cachedConfig;
}

export function updateApiConfig(patch: Partial<ApiConfig>) {
  cachedConfig = {
    baseUrl: normalizeBaseUrl(patch.baseUrl ?? cachedConfig.baseUrl),
    token: patch.token ?? cachedConfig.token,
    readOnly: patch.readOnly ?? cachedConfig.readOnly,
  };
  writeConfig(cachedConfig);
  emit();
}

export function subscribeApiConfig(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApiConfig() {
  const [config, setConfig] = useState<ApiConfig>(() => getApiConfig());

  useEffect(() => {
    const unsubscribe = subscribeApiConfig(() => setConfig(getApiConfig()));
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== API_BASE_KEY &&
        event.key !== API_TOKEN_KEY &&
        event.key !== API_READONLY_KEY
      ) {
        return;
      }
      cachedConfig = readConfig();
      setConfig(cachedConfig);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return {
    config,
    setConfig: updateApiConfig,
  };
}

export function buildApiUrl(path: string, params?: Record<string, string>) {
  const { baseUrl } = getApiConfig();
  const isAbsolute = /^https?:\/\//i.test(path);
  const raw = isAbsolute ? path : `${baseUrl}${path}`;
  const url = new URL(raw || path, isAbsolute || baseUrl ? undefined : window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function apiFetch(path: string, init?: RequestInit) {
  const { token } = getApiConfig();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('x-auth-token', token);
  }
  return fetch(buildApiUrl(path), {
    ...init,
    headers,
  });
}

export function apiEventSource(path: string) {
  const { token } = getApiConfig();
  const url = buildApiUrl(path, token ? { token } : undefined);
  return new EventSource(url);
}
