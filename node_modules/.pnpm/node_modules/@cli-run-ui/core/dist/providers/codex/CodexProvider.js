import fs from 'node:fs';
import { hashString } from '../../utils/hash.js';
import { safeJsonParse } from '../../utils/json.js';
import { basenameSafe } from '../../utils/path.js';
import { readAllLines, readLinesFromOffset } from '../../utils/stream.js';
import { nowMs, parseTimeMs } from '../../utils/time.js';
import { CodexIndex, toProjectNameFromCwd } from './CodexIndex.js';
export class CodexProvider {
    id = 'codex';
    index;
    constructor(options) {
        this.index = new CodexIndex(options);
    }
    getRootDir() {
        return this.index.getRootDir();
    }
    async listSessions() {
        await this.index.build(true);
        const sessionIds = this.index.listSessionIds();
        const sessions = [];
        for (const sessionId of sessionIds) {
            const filePath = this.index.getFilePath(sessionId);
            if (!filePath)
                continue;
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
    async getConversation(sessionId) {
        await this.index.build();
        const filePath = this.index.getFilePath(sessionId);
        if (!filePath || !fs.existsSync(filePath))
            return [];
        const lines = await readAllLines(filePath);
        const sessionUid = `${this.id}:${sessionId}`;
        const messages = [];
        const callMap = new Map();
        for (const line of lines) {
            const parsed = safeJsonParse(line);
            if (!parsed)
                continue;
            this.consumeEvent(parsed, sessionUid, line, messages, callMap);
        }
        return messages;
    }
    async getConversationStream(sessionId, fromOffset) {
        await this.index.build();
        const filePath = this.index.getFilePath(sessionId);
        if (!filePath || !fs.existsSync(filePath))
            return { messages: [], nextOffset: fromOffset };
        const { lines, nextOffset } = await readLinesFromOffset(filePath, fromOffset);
        const sessionUid = `${this.id}:${sessionId}`;
        const messages = [];
        const callMap = new Map();
        for (const line of lines) {
            const parsed = safeJsonParse(line);
            if (!parsed)
                continue;
            this.consumeEvent(parsed, sessionUid, line, messages, callMap);
        }
        return { messages, nextOffset };
    }
    filePathToSessionId(filePath) {
        const existing = this.index.getSessionIdByFile(filePath);
        if (existing)
            return existing;
        const meta = this.index.refreshFileSync(filePath);
        return meta?.sessionId ?? null;
    }
    consumeEvent(event, sessionUid, rawLine, messages, callMap) {
        if (event.type !== 'response_item')
            return;
        const payload = event.payload;
        if (!payload)
            return;
        const payloadType = payload.type;
        if (payloadType === 'message') {
            const message = this.createMessageFromPayload(payload, sessionUid, rawLine, event);
            if (message)
                messages.push(message);
            return;
        }
        if (payloadType === 'function_call') {
            const message = this.createToolCallMessage(payload, sessionUid, rawLine, event);
            if (!message)
                return;
            const callId = payload.call_id ?? '';
            if (callId)
                callMap.set(callId, message);
            messages.push(message);
            return;
        }
        if (payloadType === 'function_call_output') {
            const callId = payload.call_id ?? '';
            if (callId && callMap.has(callId)) {
                const target = callMap.get(callId);
                if (target) {
                    target.parts.push(this.createToolResultPart(payload));
                    return;
                }
            }
            const message = this.createToolResultMessage(payload, sessionUid, rawLine, event);
            if (message)
                messages.push(message);
        }
    }
    createMessageFromPayload(payload, sessionUid, rawLine, event) {
        const role = normalizeRole(payload.role);
        const content = payload.content;
        const { parts, text } = parseContent(content);
        if (parts.length === 0)
            return null;
        const createdAtMs = parseTimeMs(payload.timestamp) ??
            parseTimeMs(event.timestamp) ??
            nowMs();
        const id = (typeof payload.id === 'string' ? payload.id : undefined) ??
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
    createToolCallMessage(payload, sessionUid, rawLine, event) {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : undefined;
        const name = typeof payload.name === 'string' ? payload.name : 'tool';
        const input = parseArguments(payload.arguments);
        const createdAtMs = parseTimeMs(payload.timestamp) ??
            parseTimeMs(event.timestamp) ??
            nowMs();
        const id = (typeof payload.id === 'string' ? payload.id : undefined) ??
            `${sessionUid}:${hashString(rawLine)}`;
        const parts = [
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
    createToolResultMessage(payload, sessionUid, rawLine, event) {
        const createdAtMs = parseTimeMs(payload.timestamp) ??
            parseTimeMs(event.timestamp) ??
            nowMs();
        const id = `${sessionUid}:${hashString(rawLine)}`;
        const parts = [this.createToolResultPart(payload)];
        return {
            id,
            sessionUid,
            role: 'tool',
            createdAtMs,
            parts,
        };
    }
    createToolResultPart(payload) {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '');
        return {
            kind: 'tool_result',
            toolCallId: callId,
            output,
        };
    }
}
function normalizeRole(value) {
    if (!value)
        return 'assistant';
    if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool' || value === 'developer') {
        return value;
    }
    return 'assistant';
}
function parseContent(content) {
    if (typeof content === 'string') {
        return { parts: [{ kind: 'text', text: content }], text: content };
    }
    if (Array.isArray(content)) {
        const parts = [];
        const textParts = [];
        for (const block of content) {
            if (!block || typeof block !== 'object')
                continue;
            const type = block.type;
            if (type === 'text') {
                const text = String(block.text ?? '');
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
function parseArguments(value) {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return value;
        }
    }
    return value ?? null;
}
async function readTokenUsage(filePath) {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat)
        return null;
    const tailSize = 65536;
    const start = Math.max(0, stat.size - tailSize);
    const stream = fs.createReadStream(filePath, { start });
    const chunks = [];
    try {
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }
    }
    catch {
        return null;
    }
    const content = Buffer.concat(chunks).toString('utf8');
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        if (!line)
            continue;
        const parsed = safeJsonParse(line);
        if (!parsed)
            continue;
        if (parsed.type !== 'event_msg')
            continue;
        const payload = parsed.payload;
        if (!payload || payload.type !== 'token_count')
            continue;
        const usage = parseTokenUsage(payload);
        if (usage)
            return usage;
    }
    return null;
}
function parseTokenUsage(payload) {
    const total = payload.total_token_usage;
    const last = payload.last_token_usage;
    const usage = {};
    if (typeof total === 'number' && Number.isFinite(total)) {
        usage.total = total;
    }
    else if (total && typeof total === 'object') {
        const input = total.input;
        const output = total.output;
        if (typeof input === 'number')
            usage.input = input;
        if (typeof output === 'number')
            usage.output = output;
        if (usage.input !== undefined && usage.output !== undefined) {
            usage.total = usage.input + usage.output;
        }
    }
    if (last && typeof last === 'object') {
        const input = last.input;
        const output = last.output;
        if (typeof input === 'number')
            usage.input ??= input;
        if (typeof output === 'number')
            usage.output ??= output;
    }
    if (usage.total === undefined && usage.input === undefined && usage.output === undefined)
        return null;
    return usage;
}
//# sourceMappingURL=CodexProvider.js.map