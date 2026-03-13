export type ProviderId = 'claude' | 'codex';
export type Role = 'user' | 'assistant' | 'system' | 'tool' | 'developer';
export type ContentPart = {
    kind: 'text';
    text: string;
} | {
    kind: 'code';
    lang?: string;
    text: string;
} | {
    kind: 'tool_call';
    id: string;
    name: string;
    input: unknown;
} | {
    kind: 'tool_result';
    toolCallId: string;
    output: string;
    isError?: boolean;
} | {
    kind: 'reasoning';
    summary?: string;
    encrypted?: boolean;
} | {
    kind: 'raw';
    json: unknown;
};
export interface SessionDTO {
    uid: string;
    provider: ProviderId;
    sessionId: string;
    title: string;
    projectPath?: string;
    projectName: string;
    startedAtMs: number;
    updatedAtMs: number;
    messageCount?: number;
    usage?: {
        input?: number;
        output?: number;
        total?: number;
    };
    status?: 'active' | 'completed' | 'error';
    resumeCommand: string;
    source: {
        filePath: string;
    };
}
export interface MessageDTO {
    id: string;
    sessionUid: string;
    role: Role;
    createdAtMs: number;
    parts: ContentPart[];
    model?: string;
    text?: string;
}
export type RunMode = 'task' | 'resume';
export type RunStatus = 'starting' | 'running' | 'exited' | 'failed' | 'stopped';
export type RunStream = 'stdout' | 'stderr' | 'system';
export interface RunLogEntryDTO {
    id: string;
    runId: string;
    stream: RunStream;
    text: string;
    timestampMs: number;
}
export interface RunSessionDTO {
    id: string;
    provider: ProviderId;
    mode: RunMode;
    cwd: string;
    prompt: string;
    command: string[];
    createdAtMs: number;
    startedAtMs?: number;
    endedAtMs?: number;
    exitCode?: number | null;
    error?: string;
    status: RunStatus;
    sessionUid?: string;
}
export interface StartRunRequestDTO {
    provider: ProviderId;
    mode: RunMode;
    cwd: string;
    prompt: string;
    sessionUid?: string;
}
export type TerminalMode = 'new' | 'resume';
export type TerminalSessionStatus = 'starting' | 'open' | 'closed' | 'failed';
export interface TerminalSessionDTO {
    id: string;
    provider: ProviderId;
    mode: TerminalMode;
    cwd: string;
    command: string[];
    createdAtMs: number;
    startedAtMs?: number;
    endedAtMs?: number;
    cols: number;
    rows: number;
    status: TerminalSessionStatus;
    sessionUid?: string;
    exitCode?: number | null;
    error?: string;
}
export interface TerminalOutputDTO {
    id: string;
    terminalId: string;
    data: string;
    timestampMs: number;
}
export interface StartTerminalRequestDTO {
    provider: ProviderId;
    mode: TerminalMode;
    cwd: string;
    sessionUid?: string;
    cols?: number;
    rows?: number;
}
//# sourceMappingURL=index.d.ts.map