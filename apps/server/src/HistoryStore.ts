import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PersistedRunRecord } from './RunManager.js';
import type { PersistedTerminalRecord } from './TerminalManager.js';

interface RuntimeHistoryFile {
  version: 1;
  savedAtMs: number;
  runs: PersistedRunRecord[];
  terminals: PersistedTerminalRecord[];
}

interface RuntimeHistorySnapshot {
  runs: PersistedRunRecord[];
  terminals: PersistedTerminalRecord[];
}

const EMPTY_HISTORY: RuntimeHistorySnapshot = {
  runs: [],
  terminals: [],
};

export class HistoryStore {
  constructor(private readonly filePath = resolveHistoryFilePath()) {}

  async load(): Promise<RuntimeHistorySnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RuntimeHistoryFile>;
      return {
        runs: Array.isArray(parsed.runs) ? parsed.runs.filter(isRunRecord) : [],
        terminals: Array.isArray(parsed.terminals)
          ? parsed.terminals.filter(isTerminalRecord)
          : [],
      };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : null;
      if (code === 'ENOENT') {
        return EMPTY_HISTORY;
      }
      console.warn('[cli-run-ui] Failed to load runtime history:', error);
      return EMPTY_HISTORY;
    }
  }

  async save(snapshot: RuntimeHistorySnapshot): Promise<void> {
    const directory = path.dirname(this.filePath);
    const tempPath = `${this.filePath}.tmp`;
    const payload: RuntimeHistoryFile = {
      version: 1,
      savedAtMs: Date.now(),
      runs: trimRuns(snapshot.runs),
      terminals: trimTerminals(snapshot.terminals),
    };

    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
    await rename(tempPath, this.filePath);
  }
}

export function resolveHistoryFilePath(): string {
  const explicitFile = process.env.CLI_RUN_UI_HISTORY_FILE?.trim();
  if (explicitFile) {
    return path.resolve(explicitFile);
  }

  const explicitDir = process.env.CLI_RUN_UI_DATA_DIR?.trim();
  if (explicitDir) {
    return path.resolve(explicitDir, 'runtime-history.json');
  }

  return path.join(process.cwd(), '.cli-run-ui', 'runtime-history.json');
}

function trimRuns(runs: PersistedRunRecord[]): PersistedRunRecord[] {
  return [...runs]
    .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs)
    .slice(0, 80);
}

function trimTerminals(terminals: PersistedTerminalRecord[]): PersistedTerminalRecord[] {
  return [...terminals]
    .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs)
    .slice(0, 60);
}

function isRunRecord(value: unknown): value is PersistedRunRecord {
  return !!value && typeof value === 'object' && 'summary' in value && 'logs' in value;
}

function isTerminalRecord(value: unknown): value is PersistedTerminalRecord {
  return !!value && typeof value === 'object' && 'summary' in value && 'outputs' in value;
}
