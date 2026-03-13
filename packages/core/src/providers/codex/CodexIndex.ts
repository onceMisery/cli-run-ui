import fs from 'node:fs';
import path from 'node:path';

import { expandHome, basenameSafe } from '../../utils/path.js';
import { parseTimeMs } from '../../utils/time.js';
import { safeJsonParse } from '../../utils/json.js';

export interface CodexSessionMeta {
  sessionId: string;
  cwd?: string;
  startedAtMs?: number;
  filePath: string;
}

export class CodexIndex {
  private readonly rootDir: string;
  private readonly sessionsDir: string;
  private sessionIdToFilePath = new Map<string, string>();
  private filePathToSessionId = new Map<string, string>();
  private sessionMeta = new Map<string, CodexSessionMeta>();
  private built = false;

  constructor(options?: { rootDir?: string }) {
    this.rootDir = expandHome(options?.rootDir ?? '~/.codex');
    this.sessionsDir = path.join(this.rootDir, 'sessions');
  }

  getRootDir(): string {
    return this.rootDir;
  }

  async build(force = false): Promise<void> {
    if (this.built && !force) return;
    this.built = true;
    await this.scanSessions();
  }

  listSessionIds(): string[] {
    return Array.from(this.sessionIdToFilePath.keys());
  }

  getFilePath(sessionId: string): string | undefined {
    return this.sessionIdToFilePath.get(sessionId);
  }

  getMeta(sessionId: string): CodexSessionMeta | undefined {
    return this.sessionMeta.get(sessionId);
  }

  getSessionIdByFile(filePath: string): string | undefined {
    return this.filePathToSessionId.get(filePath);
  }

  async refreshFile(filePath: string): Promise<void> {
    const meta = await readSessionMeta(filePath);
    if (!meta) return;
    const sessionId = meta.sessionId;
    this.sessionIdToFilePath.set(sessionId, filePath);
    this.filePathToSessionId.set(filePath, sessionId);
    this.sessionMeta.set(sessionId, meta);
  }

  private async scanSessions(): Promise<void> {
    this.sessionIdToFilePath.clear();
    this.filePathToSessionId.clear();
    this.sessionMeta.clear();
    if (!fs.existsSync(this.sessionsDir)) return;
    const stack = [this.sessionsDir];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) continue;
        const meta = await readSessionMeta(fullPath);
        if (!meta) continue;
        this.sessionIdToFilePath.set(meta.sessionId, fullPath);
        this.filePathToSessionId.set(fullPath, meta.sessionId);
        this.sessionMeta.set(meta.sessionId, meta);
      }
    }
  }
}

async function readSessionMeta(filePath: string): Promise<CodexSessionMeta | null> {
  const lines = await readFirstLines(filePath, 16384);
  for (const line of lines) {
    const parsed = safeJsonParse(line) as Record<string, unknown> | null;
    if (!parsed) continue;
    if (parsed.type !== 'session_meta') continue;
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    const sessionId = typeof payload.id === 'string' ? payload.id : undefined;
    if (!sessionId) continue;
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined;
    const startedAt =
      parseTimeMs(payload.timestamp) ??
      parseTimeMs(parsed.timestamp) ??
      parseTimeMs(payload.started_at) ??
      undefined;
    return {
      sessionId,
      cwd,
      startedAtMs: startedAt,
      filePath,
    };
  }
  return null;
}

async function readFirstLines(filePath: string, maxBytes: number): Promise<string[]> {
  const stream = fs.createReadStream(filePath, { start: 0, end: maxBytes });
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve());
  });

  const content = Buffer.concat(chunks).toString('utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function toProjectNameFromCwd(cwd?: string): string {
  return basenameSafe(cwd);
}
