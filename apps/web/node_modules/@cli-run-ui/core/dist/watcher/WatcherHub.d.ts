import type { ProviderId } from '../domain/index.js';
import type { SessionProvider } from '../providers/types.js';
export type SessionsChangedListener = (provider: ProviderId) => void;
export type ConversationAppendedListener = (sessionUid: string, filePath: string) => void;
export declare class WatcherHub {
    private readonly providers;
    private readonly debounceMs;
    private watcher;
    private sessionListeners;
    private conversationListeners;
    private pendingSessions;
    private pendingConversations;
    private flushTimer;
    constructor(providers: SessionProvider[], options?: {
        debounceMs?: number;
    });
    start(): void;
    stop(): void;
    onSessionsChanged(listener: SessionsChangedListener): () => void;
    onConversationAppended(listener: ConversationAppendedListener): () => void;
    private getWatchGlobs;
    private handleFileChange;
    private queueSessionsChanged;
    private queueConversation;
    private scheduleFlush;
    private flush;
}
//# sourceMappingURL=WatcherHub.d.ts.map