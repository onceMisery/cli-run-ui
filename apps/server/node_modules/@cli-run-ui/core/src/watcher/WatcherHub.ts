import chokidar from 'chokidar';

import type { ProviderId } from '../domain/index.js';
import type { ProviderEvent, SessionProvider } from '../providers/types.js';

export type SessionsChangedListener = (provider: ProviderId) => void;
export type ConversationAppendedListener = (sessionUid: string, filePath: string) => void;

export class WatcherHub {
  private readonly providers: SessionProvider[];
  private readonly debounceMs: number;
  private watcher: chokidar.FSWatcher | null = null;

  private sessionListeners = new Set<SessionsChangedListener>();
  private conversationListeners = new Set<ConversationAppendedListener>();

  private pendingSessions = new Set<ProviderId>();
  private pendingConversations = new Map<string, { sessionUid: string; filePath: string }>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(providers: SessionProvider[], options?: { debounceMs?: number }) {
    this.providers = providers;
    this.debounceMs = options?.debounceMs ?? 200;
  }

  start(): void {
    if (this.watcher) return;
    const globs = this.providers.flatMap((provider) => this.getWatchGlobs(provider));
    this.watcher = chokidar.watch(globs, { ignoreInitial: true });

    this.watcher.on('add', (filePath) => this.handleFileChange(filePath));
    this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
  }

  stop(): void {
    if (!this.watcher) return;
    void this.watcher.close();
    this.watcher = null;
  }

  onSessionsChanged(listener: SessionsChangedListener): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  onConversationAppended(listener: ConversationAppendedListener): () => void {
    this.conversationListeners.add(listener);
    return () => this.conversationListeners.delete(listener);
  }

  private getWatchGlobs(provider: SessionProvider): string[] {
    const root = normalizePath(provider.getRootDir());
    if (provider.id === 'claude') {
      return [
        `${root}/history.jsonl`,
        `${root}/projects/**/*.jsonl`,
      ];
    }
    if (provider.id === 'codex') {
      return [`${root}/sessions/**/rollout-*.jsonl`];
    }
    return [];
  }

  private handleFileChange(filePath: string): void {
    const normalized = normalizePath(filePath);
    const provider = this.providers.find((item) =>
      normalized.startsWith(normalizePath(item.getRootDir()))
    );
    if (!provider) return;

    if (provider.id === 'claude') {
      if (normalized.endsWith('/history.jsonl')) {
        this.queueSessionsChanged(provider.id);
        return;
      }
      if (normalized.includes('/projects/') && normalized.endsWith('.jsonl')) {
        const sessionId = provider.filePathToSessionId(filePath);
        if (!sessionId) return;
        this.queueConversation(provider.id, sessionId, filePath);
        return;
      }
    }

    if (provider.id === 'codex') {
      if (normalized.includes('/sessions/') && /rollout-.*\.jsonl$/.test(normalized)) {
        this.queueSessionsChanged(provider.id);
        const sessionId = provider.filePathToSessionId(filePath);
        if (!sessionId) return;
        this.queueConversation(provider.id, sessionId, filePath);
      }
    }
  }

  private queueSessionsChanged(provider: ProviderId): void {
    this.pendingSessions.add(provider);
    this.scheduleFlush();
  }

  private queueConversation(provider: ProviderId, sessionId: string, filePath: string): void {
    const sessionUid = `${provider}:${sessionId}`;
    this.pendingConversations.set(sessionUid, { sessionUid, filePath });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    for (const provider of this.pendingSessions) {
      for (const listener of this.sessionListeners) {
        listener(provider);
      }
    }
    this.pendingSessions.clear();

    for (const change of this.pendingConversations.values()) {
      for (const listener of this.conversationListeners) {
        listener(change.sessionUid, change.filePath);
      }
    }
    this.pendingConversations.clear();
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
