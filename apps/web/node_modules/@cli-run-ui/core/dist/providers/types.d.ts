import type { MessageDTO, SessionDTO } from '../domain/index.js';
export interface ConversationStreamChunk {
    messages: MessageDTO[];
    nextOffset: number;
}
export type ProviderEvent = {
    type: 'sessions_changed';
    provider: 'claude' | 'codex';
} | {
    type: 'conversation_appended';
    sessionUid: string;
    filePath: string;
};
export interface SessionProvider {
    id: 'claude' | 'codex';
    getRootDir(): string;
    listSessions(): Promise<SessionDTO[]>;
    getConversation(sessionId: string): Promise<MessageDTO[]>;
    getConversationStream(sessionId: string, fromOffset: number): Promise<ConversationStreamChunk>;
    filePathToSessionId(filePath: string): string | null;
}
//# sourceMappingURL=types.d.ts.map