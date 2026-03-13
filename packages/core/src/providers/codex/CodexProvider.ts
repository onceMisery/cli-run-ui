import fs from 'node:fs';

import type { ContentPart, MessageDTO, SessionDTO } from '../../domain/index.js';
import type { ConversationStreamChunk, SessionProvider } from '../types.js';
import { hashString } from '../../utils/hash.js';
import { safeJsonParse } from '../../utils/json.js';
import { basenameSafe } from '../../utils/path.js';
import { readAllLines, readLinesFromOffset } from '../../utils/stream.js';
import { nowMs, parseTimeMs } from '../../utils/time.js';

import { CodexIndex, toProjectNameFromCwd } from './CodexIndex.js';

export class CodexProvider implements SessionProvider {
  public readonly id = 'codex' as const;
  private readonly index: CodexIndex;

  constructor(options?: { rootDir?: string }) {
    this.index = new CodexIndex(options);
  }

  getRootDir(): string {
    return this.index.getRootDir();
  }

  async listSessions(): Promise<SessionDTO[]> {
    await this.index.build(true);
    const sessionIds = this.index.listSessionIds();
    const sessions: SessionDTO[] = [];

    for (const sessionId of sessionIds) {
      const filePath = this.index.getFilePath(sessionId);
      if (!filePath) continue;
      const meta = this.index.getMeta(sessionId);
      const stat = await fs.promises.stat(filePath).catch(() => null);
      const updatedAtMs = stat?.mtimeMs ?? nowMs();
      const startedAtMs = meta?.startedAtMs ?? updatedAtMs;
      const projectPath = meta?.cwd;
      const projectName = toProjectNameFromCwd(projectPath);
      const title = `session-${sessionId.slice(0, 8)}`;
      const resumeCommand = `codex --resume ${sessionId}`;
      const usage = await readTokenUsage(filePath);

      sessions.push({
        uid: `${this.id}:${sessionId}`,
        provider: this.id,
        sessionId,
        title,
        projectPath: projectPath ?? undefined,
        projectName: projectName ?? basenameSafe(projectPath),
        startedAtMs,
        updatedAtMs,
        usage: usage ?? undefined,
        resumeCommand,
        source: { filePath },
      });
    }

    sessions.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return sessions;
  }

  async getConversation(sessionId: string): Promise<MessageDTO[]> {
    await this.index.build();
    const filePath = this.index.getFilePath(sessionId);
    if (!filePath || !fs.existsSync(filePath)) return [];
    const lines = await readAllLines(filePath);
    const sessionUid = `${this.id}:${sessionId}`;
    const messages: MessageDTO[] = [];
    const callMap = new Map<string, MessageDTO>();

    for (const line of lines) {
      const parsed = safeJsonParse(line) as Record<string, unknown> | null;
      if (!parsed) continue;
      this.consumeEvent(parsed, sessionUid, line, messages, callMap);
    }

    return messages;
  }

  async getConversationStream(sessionId: string, fromOffset: number): Promise<ConversationStreamChunk> {
    await this.index.build();
    const filePath = this.index.getFilePath(sessionId);
    if (!filePath || !fs.existsSync(filePath)) return { messages: [], nextOffset: fromOffset };

    const { lines, nextOffset } = await readLinesFromOffset(filePath, fromOffset);
    const sessionUid = `${this.id}:${sessionId}`;
    const messages: MessageDTO[] = [];
    const callMap = new Map<string, MessageDTO>();

    for (const line of lines) {
      const parsed = safeJsonParse(line) as Record<string, unknown> | null;
      if (!parsed) continue;
      this.consumeEvent(parsed, sessionUid, line, messages, callMap);
    }

    return { messages, nextOffset };
  }

  filePathToSessionId(filePath: string): string | null {
    const existing = this.index.getSessionIdByFile(filePath);
    if (existing) return existing;
    const meta = this.index.refreshFileSync(filePath);
    return meta?.sessionId ?? null;
  }

  private consumeEvent(
    event: Record<string, unknown>,
    sessionUid: string,
    rawLine: string,
    messages: MessageDTO[],
    callMap: Map<string, MessageDTO>,
  ): void {
    if (event.type !== 'response_item') return;
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    const payloadType = payload.type;
    if (payloadType === 'message') {
      const message = this.createMessageFromPayload(payload, sessionUid, rawLine, event);
      if (message) messages.push(message);
      return;
    }

    if (payloadType === 'function_call') {
      const message = this.createToolCallMessage(payload, sessionUid, rawLine, event);
      if (!message) return;
      const callId = (payload.call_id as string | undefined) ?? '';
      if (callId) callMap.set(callId, message);
      messages.push(message);
      return;
    }

    if (payloadType === 'function_call_output') {
      const callId = (payload.call_id as string | undefined) ?? '';
      if (callId && callMap.has(callId)) {
        const target = callMap.get(callId);
        if (target) {
          target.parts.push(this.createToolResultPart(payload));
          return;
        }
      }

      const message = this.createToolResultMessage(payload, sessionUid, rawLine, event);
      if (message) messages.push(message);
    }
  }

  private createMessageFromPayload(
    payload: Record<string, unknown>,
    sessionUid: string,
    rawLine: string,
    event: Record<string, unknown>
  ): MessageDTO | null {
    const role = normalizeRole(payload.role as string | undefined);
    const content = payload.content;
    const { parts, text } = parseContent(content);
    if (parts.length === 0) return null;

    const createdAtMs =
      parseTimeMs(payload.timestamp) ??
      parseTimeMs(event.timestamp) ??
      nowMs();

    const id =
      (typeof payload.id === 'string' ? payload.id : undefined) ??
      (typeof event.id === 'string' ? event.id : undefined) ??
      `${sessionUid}:${hashString(rawLine)}`;

    const model = typeof payload.model === 'string' ? payload.model : undefined;

    return {
      id,
      sessionUid,
      role,
      createdAtMs,
      parts,
      model,
      text,
    };
  }

  private createToolCallMessage(
    payload: Record<string, unknown>,
    sessionUid: string,
    rawLine: string,
    event: Record<string, unknown>
  ): MessageDTO | null {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
    const name = typeof payload.name === 'string' ? payload.name : 'tool';
    const input = parseArguments(payload.arguments);

    const createdAtMs =
      parseTimeMs(payload.timestamp) ??
      parseTimeMs(event.timestamp) ??
      nowMs();

    const id =
      (typeof payload.id === 'string' ? payload.id : undefined) ??
      `${sessionUid}:${hashString(rawLine)}`;

    const parts: ContentPart[] = [
      {
        kind: 'tool_call',
        id: callId ?? id,
        name,
        input,
      },
    ];

    return {
      id,
      sessionUid,
      role: 'assistant',
      createdAtMs,
      parts,
    };
  }

  private createToolResultMessage(
    payload: Record<string, unknown>,
    sessionUid: string,
    rawLine: string,
    event: Record<string, unknown>
  ): MessageDTO | null {
    const createdAtMs =
      parseTimeMs(payload.timestamp) ??
      parseTimeMs(event.timestamp) ??
      nowMs();
    const id = `${sessionUid}:${hashString(rawLine)}`;
    const parts: ContentPart[] = [this.createToolResultPart(payload)];

    return {
      id,
      sessionUid,
      role: 'tool',
      createdAtMs,
      parts,
    };
  }

  private createToolResultPart(payload: Record<string, unknown>): ContentPart {
    const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
    const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
    return {
      kind: 'tool_result',
      toolCallId: callId,
      output,
    };
  }
}

function normalizeRole(value?: string): MessageDTO['role'] {
  if (!value) return 'assistant';
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool' || value === 'developer') {
    return value;
  }
  return 'assistant';
}

function parseContent(content: unknown): { parts: ContentPart[]; text?: string } {
  if (typeof content === 'string') {
    return { parts: [{ kind: 'text', text: content }], text: content };
  }

  if (Array.isArray(content)) {
    const parts: ContentPart[] = [];
    const textParts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const type = (block as Record<string, unknown>).type;
      if (type === 'text') {
        const text = String((block as Record<string, unknown>).text ?? '');
        parts.push({ kind: 'text', text });
        textParts.push(text);
        continue;
      }
      parts.push({ kind: 'raw', json: block });
    }
    return { parts, text: textParts.length > 0 ? textParts.join('') : undefined };
  }

  return { parts: [{ kind: 'raw', json: content }], text: undefined };
}

function parseArguments(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value ?? null;
}

async function readTokenUsage(filePath: string): Promise<SessionDTO['usage'] | null> {
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat) return null;
  const tailSize = 65536;
  const start = Math.max(0, stat.size - tailSize);
  const stream = fs.createReadStream(filePath, { start });
  const chunks: Buffer[] = [];

  try {
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
  } catch {
    return null;
  }

  const content = Buffer.concat(chunks).toString('utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) continue;
    const parsed = safeJsonParse(line) as Record<string, unknown> | null;
    if (!parsed) continue;
    if (parsed.type !== 'event_msg') continue;
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (!payload || payload.type !== 'token_count') continue;
    const usage = parseTokenUsage(payload);
    if (usage) return usage;
  }

  return null;
}

function parseTokenUsage(payload: Record<string, unknown>): SessionDTO['usage'] | null {
  const total = payload.total_token_usage;
  const last = payload.last_token_usage;

  const usage: SessionDTO['usage'] = {};

  if (typeof total === 'number' && Number.isFinite(total)) {
    usage.total = total;
  } else if (total && typeof total === 'object') {
    const input = (total as Record<string, unknown>).input;
    const output = (total as Record<string, unknown>).output;
    if (typeof input === 'number') usage.input = input;
    if (typeof output === 'number') usage.output = output;
    if (usage.input !== undefined && usage.output !== undefined) {
      usage.total = usage.input + usage.output;
    }
  }

  if (last && typeof last === 'object') {
    const input = (last as Record<string, unknown>).input;
    const output = (last as Record<string, unknown>).output;
    if (typeof input === 'number') usage.input ??= input;
    if (typeof output === 'number') usage.output ??= output;
  }

  if (usage.total === undefined && usage.input === undefined && usage.output === undefined) return null;
  return usage;
}
