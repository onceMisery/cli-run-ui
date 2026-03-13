import fs from 'node:fs';
import path from 'node:path';
import { hashString } from '../../utils/hash.js';
import { pickNumber, pickString } from '../../utils/json.js';
import { expandHome, basenameSafe } from '../../utils/path.js';
import { readAllLines, readLinesFromOffset } from '../../utils/stream.js';
import { nowMs, parseTimeMs } from '../../utils/time.js';
const HISTORY_FILE = 'history.jsonl';
const PROJECTS_DIR = 'projects';
export class ClaudeProvider {
    id = 'claude';
    rootDir;
    historyPath;
    projectsDir;
    sessionIdToFilePath = new Map();
    filePathToSessionIdMap = new Map();
    historyCache = [];
    historyMtimeMs = null;
    constructor(options) {
        this.rootDir = expandHome(options?.rootDir ?? '~/.claude');
        this.historyPath = path.join(this.rootDir, HISTORY_FILE);
        this.projectsDir = path.join(this.rootDir, PROJECTS_DIR);
    }
    getRootDir() {
        return this.rootDir;
    }
    async listSessions() {
        await this.buildFileIndex();
        await this.ensureHistoryCache();
        return this.historyCache;
    }
    async getConversation(sessionId) {
        await this.ensureFileIndex();
        const filePath = this.sessionIdToFilePath.get(sessionId);
        if (!filePath || !fs.existsSync(filePath))
            return [];
        const lines = await readAllLines(filePath);
        const sessionUid = `${this.id}:${sessionId}`;
        const messages = [];
        for (const line of lines) {
            const parsed = safeParseJson(line);
            if (!parsed)
                continue;
            const message = this.parseConversationEntry(parsed, sessionUid, line);
            if (message)
                messages.push(message);
        }
        return messages;
    }
    async getConversationStream(sessionId, fromOffset) {
        await this.ensureFileIndex();
        const filePath = this.sessionIdToFilePath.get(sessionId);
        if (!filePath || !fs.existsSync(filePath))
            return { messages: [], nextOffset: fromOffset };
        const { lines, nextOffset } = await readLinesFromOffset(filePath, fromOffset);
        const sessionUid = `${this.id}:${sessionId}`;
        const messages = [];
        for (const line of lines) {
            const parsed = safeParseJson(line);
            if (!parsed)
                continue;
            const message = this.parseConversationEntry(parsed, sessionUid, line);
            if (message)
                messages.push(message);
        }
        return { messages, nextOffset };
    }
    filePathToSessionId(filePath) {
        const existing = this.filePathToSessionIdMap.get(filePath);
        if (existing)
            return existing;
        if (filePath.endsWith('.jsonl')) {
            const sessionId = path.basename(filePath).replace(/\.jsonl$/i, '');
            if (sessionId.length > 0) {
                this.sessionIdToFilePath.set(sessionId, filePath);
                this.filePathToSessionIdMap.set(filePath, sessionId);
                return sessionId;
            }
        }
        return null;
    }
    async ensureHistoryCache() {
        if (!fs.existsSync(this.historyPath)) {
            this.historyCache = [];
            return;
        }
        const stat = await fs.promises.stat(this.historyPath);
        if (this.historyMtimeMs && stat.mtimeMs === this.historyMtimeMs)
            return;
        this.historyMtimeMs = stat.mtimeMs;
        const lines = await readAllLines(this.historyPath);
        const sessions = [];
        for (const line of lines) {
            const entry = safeParseJson(line);
            if (!entry)
                continue;
            const session = this.parseHistoryEntry(entry);
            if (session)
                sessions.push(session);
        }
        sessions.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        this.historyCache = sessions;
    }
    async ensureFileIndex() {
        if (this.sessionIdToFilePath.size > 0)
            return;
        await this.buildFileIndex();
    }
    async buildFileIndex() {
        this.sessionIdToFilePath.clear();
        this.filePathToSessionIdMap.clear();
        if (!fs.existsSync(this.projectsDir))
            return;
        const stack = [this.projectsDir];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current)
                continue;
            const entries = await fs.promises.readdir(current, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                    continue;
                }
                if (!entry.isFile())
                    continue;
                if (!entry.name.endsWith('.jsonl'))
                    continue;
                const sessionId = entry.name.replace(/\.jsonl$/i, '');
                this.sessionIdToFilePath.set(sessionId, fullPath);
                this.filePathToSessionIdMap.set(fullPath, sessionId);
            }
        }
    }
    parseHistoryEntry(entry) {
        const sessionId = pickString(entry, ['sessionId', 'session_id', 'id', 'sid']);
        if (!sessionId)
            return null;
        const title = pickString(entry, ['title', 'sessionTitle', 'name']) ?? `session-${sessionId.slice(0, 8)}`;
        const projectPath = pickString(entry, ['project', 'project_path', 'cwd']);
        const projectName = pickString(entry, ['projectName', 'project_name']) ?? basenameSafe(projectPath);
        const startedAt = parseTimeMs(pickNumber(entry, ['startedAt', 'started_at', 'created_at', 'createdAt'])) ??
            parseTimeMs(pickString(entry, ['startedAt', 'started_at', 'created_at', 'createdAt'])) ??
            nowMs();
        const updatedAt = parseTimeMs(pickNumber(entry, ['updatedAt', 'updated_at', 'last_message_at', 'lastMessageAt'])) ??
            parseTimeMs(pickString(entry, ['updatedAt', 'updated_at', 'last_message_at', 'lastMessageAt'])) ??
            startedAt;
        const filePath = this.sessionIdToFilePath.get(sessionId) ??
            pickString(entry, ['filePath', 'path', 'file_path']) ??
            '';
        const resumeCommand = pickString(entry, ['resumeCommand', 'resume_command', 'resume']) ??
            `claude --resume ${sessionId}`;
        const messageCount = pickNumber(entry, ['messageCount', 'message_count']);
        return {
            uid: `${this.id}:${sessionId}`,
            provider: this.id,
            sessionId,
            title,
            projectPath: projectPath ?? undefined,
            projectName,
            startedAtMs: startedAt,
            updatedAtMs: updatedAt,
            messageCount: messageCount ?? undefined,
            resumeCommand,
            source: { filePath },
        };
    }
    parseConversationEntry(entry, sessionUid, rawLine) {
        const message = (entry.message ?? entry);
        const roleCandidate = pickString(message, ['role']) ??
            (typeof entry.type === 'string' ? entry.type : undefined);
        const role = normalizeRole(roleCandidate);
        const content = message.content;
        const parts = [];
        const textParts = [];
        if (typeof content === 'string') {
            parts.push({ kind: 'text', text: content });
            textParts.push(content);
        }
        else if (Array.isArray(content)) {
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
                if (type === 'tool_use') {
                    const id = String(block.id ?? '');
                    const name = String(block.name ?? 'tool');
                    const input = block.input ?? null;
                    parts.push({ kind: 'tool_call', id, name, input });
                    continue;
                }
                if (type === 'tool_result') {
                    const toolCallId = String(block.tool_use_id ??
                        block.id ??
                        '');
                    const output = extractText(block.content);
                    const isError = Boolean(block.is_error);
                    parts.push({ kind: 'tool_result', toolCallId, output, isError });
                    continue;
                }
                if (type === 'thinking' || type === 'reasoning') {
                    const summary = String(block.summary ?? '');
                    const encrypted = Boolean(block.encrypted);
                    parts.push({ kind: 'reasoning', summary, encrypted });
                    continue;
                }
                parts.push({ kind: 'raw', json: block });
            }
        }
        const createdAtMs = parseTimeMs(pickNumber(message, ['created_at', 'createdAt', 'timestamp'])) ??
            parseTimeMs(pickString(message, ['created_at', 'createdAt', 'timestamp'])) ??
            nowMs();
        const id = pickString(message, ['id', 'message_id']) ??
            pickString(entry, ['id']) ??
            `${sessionUid}:${hashString(rawLine)}`;
        const model = pickString(message, ['model', 'model_id']);
        return {
            id,
            sessionUid,
            role,
            createdAtMs,
            parts,
            model: model ?? undefined,
            text: textParts.length > 0 ? textParts.join('') : undefined,
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
function safeParseJson(line) {
    try {
        return JSON.parse(line);
    }
    catch {
        return null;
    }
}
function extractText(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value)) {
        return value
            .map((item) => {
            if (!item || typeof item !== 'object')
                return '';
            const text = item.text;
            return typeof text === 'string' ? text : '';
        })
            .join('');
    }
    if (value === null || value === undefined)
        return '';
    return JSON.stringify(value);
}
//# sourceMappingURL=ClaudeProvider.js.map