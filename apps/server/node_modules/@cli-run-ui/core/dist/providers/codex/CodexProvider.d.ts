import type { MessageDTO, SessionDTO } from '../../domain/index.js';
import type { ConversationStreamChunk, SessionProvider } from '../types.js';
export declare class CodexProvider implements SessionProvider {
    readonly id: "codex";
    private readonly index;
    constructor(options?: {
        rootDir?: string;
    });
    getRootDir(): string;
    listSessions(): Promise<SessionDTO[]>;
    getConversation(sessionId: string): Promise<MessageDTO[]>;
    getConversationStream(sessionId: string, fromOffset: number): Promise<ConversationStreamChunk>;
    filePathToSessionId(filePath: string): string | null;
    private consumeEvent;
    private createMessageFromPayload;
    private createToolCallMessage;
    private createToolResultMessage;
    private createToolResultPart;
}
//# sourceMappingURL=CodexProvider.d.ts.map