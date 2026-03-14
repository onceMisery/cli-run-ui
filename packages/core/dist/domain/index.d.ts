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
    bootPrompt?: string;
    cols?: number;
    rows?: number;
}
export type AgentRelayStatus = 'starting' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
export type AgentRelayTurnStatus = 'running' | 'completed' | 'failed' | 'stopped';
export interface AgentRelayParticipantDTO {
    id: string;
    provider: ProviderId;
    label: string;
}
export interface AgentRelayParticipantInputDTO {
    provider: ProviderId;
    label: string;
}
export interface AgentRelaySessionDTO {
    id: string;
    cwd: string;
    title: string;
    initialPrompt: string;
    starter: ProviderId;
    participants: AgentRelayParticipantDTO[];
    systemPrompt?: string;
    summary?: string;
    maxTurns: number;
    createdAtMs: number;
    startedAtMs?: number;
    endedAtMs?: number;
    currentTurn: number;
    status: AgentRelayStatus;
    error?: string;
}
export interface AgentRelayTurnDTO {
    id: string;
    relayId: string;
    turn: number;
    agent: ProviderId;
    participantId: string;
    participantLabel: string;
    prompt: string;
    output: string;
    startedAtMs: number;
    endedAtMs?: number;
    status: AgentRelayTurnStatus;
    exitCode?: number | null;
    error?: string;
}
export interface AgentRelayInterventionDTO {
    id: string;
    relayId: string;
    content: string;
    createdAtMs: number;
    updatedAtMs?: number;
    pinned?: boolean;
    sortOrder?: number;
}
export interface StartAgentRelayRequestDTO {
    cwd: string;
    prompt: string;
    starter: ProviderId;
    maxTurns: number;
    title?: string;
    systemPrompt?: string;
    participants?: AgentRelayParticipantInputDTO[];
    initialPinnedRules?: string[];
}
export interface PostAgentRelayInterventionRequestDTO {
    content: string;
}
export interface PatchAgentRelayInterventionRequestDTO {
    content?: string;
    pinned?: boolean;
}
export interface RemoveAgentRelayInterventionDTO {
    relayId: string;
    interventionId: string;
}
export interface MoveAgentRelayInterventionRequestDTO {
    direction: 'up' | 'down';
}
export type AgentTaskStatus = 'preparing' | 'running' | 'ready' | 'failed' | 'stopped' | 'merged';
export type AgentTaskTestStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped';
export type AgentTaskEventKind = 'system' | 'git' | 'test' | 'github';
export type AgentTaskEventTone = 'info' | 'success' | 'error';
export type GitFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unknown';
export type GitHubReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
export type GitHubMergeMethod = 'merge' | 'squash' | 'rebase';
export interface GitChangedFileDTO {
    path: string;
    status: GitFileChangeStatus;
    previousPath?: string;
}
export interface GitHubRepoRefDTO {
    owner: string;
    name: string;
    defaultBranch?: string;
    remoteUrl?: string;
    compareUrl?: string;
    connected: boolean;
    tokenConfigured: boolean;
    provider: 'github' | 'unknown';
    lastError?: string;
}
export interface GitHubPullRequestDTO {
    number: number;
    url: string;
    title: string;
    state: 'open' | 'closed' | 'merged' | 'draft';
    headBranch: string;
    baseBranch: string;
    createdAtMs: number;
    mergedAtMs?: number;
}
export interface GitHubIssueDTO {
    number: number;
    url: string;
    title: string;
    state: 'open' | 'closed';
    body?: string;
    createdAtMs: number;
    updatedAtMs?: number;
}
export interface AgentTaskTestResultDTO {
    command?: string;
    status: AgentTaskTestStatus;
    output: string;
    startedAtMs?: number;
    endedAtMs?: number;
    exitCode?: number | null;
    error?: string;
}
export interface AgentTaskEventDTO {
    id: string;
    taskId: string;
    kind: AgentTaskEventKind;
    tone: AgentTaskEventTone;
    message: string;
    createdAtMs: number;
}
export interface AgentTaskDTO {
    id: string;
    title: string;
    provider: ProviderId;
    mode: RunMode;
    cwd: string;
    prompt: string;
    repoRoot: string;
    repoName: string;
    baseBranch: string;
    branchName: string;
    createdAtMs: number;
    startedAtMs?: number;
    endedAtMs?: number;
    status: AgentTaskStatus;
    runId?: string;
    sessionUid?: string;
    testCommand?: string;
    workingTreeStatus: 'clean' | 'dirty';
    diffStat?: string;
    diffExcerpt?: string;
    changedFiles: GitChangedFileDTO[];
    testResult: AgentTaskTestResultDTO;
    github: GitHubRepoRefDTO;
    sourceIssue?: GitHubIssueDTO;
    pullRequest?: GitHubPullRequestDTO;
    error?: string;
    lastRefreshedAtMs?: number;
}
export interface StartAgentTaskRequestDTO {
    title?: string;
    provider: ProviderId;
    mode: RunMode;
    cwd: string;
    prompt: string;
    issueUrl?: string;
    sessionUid?: string;
    baseBranch?: string;
    branchName?: string;
    testCommand?: string;
}
export interface ImportGitHubIssueRequestDTO {
    issueUrl: string;
    cwd?: string;
}
export interface ImportedGitHubIssueDraftDTO {
    issue: GitHubIssueDTO;
    title: string;
    prompt: string;
    branchName: string;
}
export interface RefreshAgentTaskRequestDTO {
    rerunTests?: boolean;
}
export interface CreateTaskPullRequestRequestDTO {
    title?: string;
    body?: string;
    draft?: boolean;
    commitMessage?: string;
}
export interface ReviewTaskPullRequestRequestDTO {
    event: GitHubReviewEvent;
    body?: string;
}
export interface MergeTaskPullRequestRequestDTO {
    method?: GitHubMergeMethod;
    commitTitle?: string;
}
//# sourceMappingURL=index.d.ts.map