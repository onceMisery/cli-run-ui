export function safeJsonParse(line: string): unknown | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const value = getByPath(obj as Record<string, unknown>, key);
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function pickNumber(obj: unknown, keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const value = getByPath(obj as Record<string, unknown>, key);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}