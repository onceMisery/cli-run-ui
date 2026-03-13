import type { MessageDTO, SessionDTO } from '../../domain/index.js';
import type { ConversationStreamChunk, SessionProvider } from '../types.js';
export declare class ClaudeProvider implements SessionProvider {
    readonly id: "claude";
    private readonly rootDir;
    private readonly historyPath;
    private readonly projectsDir;
    private sessionIdToFilePath;
    private filePathToSessionIdMap;
    private historyCache;
    private historyMtimeMs;
    constructor(options?: {
        rootDir?: string;
    });
    getRootDir(): string;
    listSessions(): Promise<SessionDTO[]>;
    getConversation(sessionId: string): Promise<MessageDTO[]>;
    getConversationStream(sessionId: string, fromOffset: number): Promise<ConversationStreamChunk>;
    filePathToSessionId(filePath: string): string | null;
    private ensureHistoryCache;
    private ensureFileIndex;
    private buildFileIndex;
    private parseHistoryEntry;
    private parseConversationEntry;
}
//# sourceMappingURL=ClaudeProvider.d.ts.map