export interface CodexSessionMeta {
    sessionId: string;
    cwd?: string;
    startedAtMs?: number;
    filePath: string;
}
export declare class CodexIndex {
    private readonly rootDir;
    private readonly sessionsDir;
    private sessionIdToFilePath;
    private filePathToSessionId;
    private sessionMeta;
    private built;
    constructor(options?: {
        rootDir?: string;
    });
    getRootDir(): string;
    build(force?: boolean): Promise<void>;
    listSessionIds(): string[];
    getFilePath(sessionId: string): string | undefined;
    getMeta(sessionId: string): CodexSessionMeta | undefined;
    getSessionIdByFile(filePath: string): string | undefined;
    refreshFileSync(filePath: string): CodexSessionMeta | null;
    refreshFile(filePath: string): Promise<void>;
    private scanSessions;
}
export declare function toProjectNameFromCwd(cwd?: string): string;
//# sourceMappingURL=CodexIndex.d.ts.map