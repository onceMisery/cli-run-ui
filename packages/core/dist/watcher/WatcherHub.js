import chokidar from 'chokidar';
export class WatcherHub {
    providers;
    debounceMs;
    watcher = null;
    sessionListeners = new Set();
    conversationListeners = new Set();
    pendingSessions = new Set();
    pendingConversations = new Map();
    flushTimer = null;
    constructor(providers, options) {
        this.providers = providers;
        this.debounceMs = options?.debounceMs ?? 200;
    }
    start() {
        if (this.watcher)
            return;
        const globs = this.providers.flatMap((provider) => this.getWatchGlobs(provider));
        this.watcher = chokidar.watch(globs, { ignoreInitial: true });
        this.watcher.on('add', (filePath) => this.handleFileChange(filePath));
        this.watcher.on('change', (filePath) => this.handleFileChange(filePath));
    }
    stop() {
        if (!this.watcher)
            return;
        void this.watcher.close();
        this.watcher = null;
    }
    onSessionsChanged(listener) {
        this.sessionListeners.add(listener);
        return () => this.sessionListeners.delete(listener);
    }
    onConversationAppended(listener) {
        this.conversationListeners.add(listener);
        return () => this.conversationListeners.delete(listener);
    }
    getWatchGlobs(provider) {
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
    handleFileChange(filePath) {
        const normalized = normalizePath(filePath);
        const provider = this.providers.find((item) => normalized.startsWith(normalizePath(item.getRootDir())));
        if (!provider)
            return;
        if (provider.id === 'claude') {
            if (normalized.endsWith('/history.jsonl')) {
                this.queueSessionsChanged(provider.id);
                return;
            }
            if (normalized.includes('/projects/') && normalized.endsWith('.jsonl')) {
                const sessionId = provider.filePathToSessionId(filePath);
                if (!sessionId)
                    return;
                this.queueConversation(provider.id, sessionId, filePath);
                return;
            }
        }
        if (provider.id === 'codex') {
            if (normalized.includes('/sessions/') && /rollout-.*\.jsonl$/.test(normalized)) {
                this.queueSessionsChanged(provider.id);
                const sessionId = provider.filePathToSessionId(filePath);
                if (!sessionId)
                    return;
                this.queueConversation(provider.id, sessionId, filePath);
            }
        }
    }
    queueSessionsChanged(provider) {
        this.pendingSessions.add(provider);
        this.scheduleFlush();
    }
    queueConversation(provider, sessionId, filePath) {
        const sessionUid = `${provider}:${sessionId}`;
        this.pendingConversations.set(sessionUid, { sessionUid, filePath });
        this.scheduleFlush();
    }
    scheduleFlush() {
        if (this.flushTimer)
            return;
        this.flushTimer = setTimeout(() => this.flush(), this.debounceMs);
    }
    flush() {
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
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
//# sourceMappingURL=WatcherHub.js.map