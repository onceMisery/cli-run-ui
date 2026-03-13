export type ProviderId = 'claude' | 'codex';
export type Role = 'user' | 'assistant' | 'system' | 'tool' | 'developer';

export type ContentPart =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; toolCallId: string; output: string; isError?: boolean }
  | { kind: 'reasoning'; summary?: string; encrypted?: boolean }
  | { kind: 'raw'; json: unknown };

export interface SessionDTO {
  uid: string; // `${provider}:${sessionId}`
  provider: ProviderId;
  sessionId: string;
  title: string;
  projectPath?: string;
  projectName: string;
  startedAtMs: number;
  updatedAtMs: number;
  messageCount?: number;
  usage?: { input?: number; output?: number; total?: number };
  status?: 'active' | 'completed' | 'error';
  resumeCommand: string;
  source: { filePath: string };
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