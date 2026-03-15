import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import { resolveProviderCliCommand } from './providerCommands.js';
export class TerminalManager {
    terminals = new Map();
    sessionListeners = new Set();
    outputListeners = new Set();
    constructor(restoredSessions = []) {
        this.restore(restoredSessions);
    }
    listSessions() {
        return Array.from(this.terminals.values())
            .map((terminal) => terminal.summary)
            .sort((a, b) => b.createdAtMs - a.createdAtMs);
    }
    getSession(terminalId) {
        return this.terminals.get(terminalId)?.summary ?? null;
    }
    getOutputs(terminalId) {
        return this.terminals.get(terminalId)?.outputs ?? [];
    }
    listPersistedSessions() {
        return Array.from(this.terminals.values())
            .map((terminal) => ({
            summary: terminal.summary,
            outputs: [...terminal.outputs],
        }))
            .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs);
    }
    onSession(listener) {
        this.sessionListeners.add(listener);
        return () => this.sessionListeners.delete(listener);
    }
    onOutput(listener) {
        this.outputListeners.add(listener);
        return () => this.outputListeners.delete(listener);
    }
    async startSession(request) {
        const createdAtMs = Date.now();
        const terminalId = randomUUID();
        const spec = buildTerminalSpec(request);
        const summary = {
            id: terminalId,
            provider: request.provider,
            mode: request.mode,
            cwd: request.cwd,
            command: spec.displayCommand,
            createdAtMs,
            startedAtMs: createdAtMs,
            cols: spec.cols,
            rows: spec.rows,
            status: 'starting',
            sessionUid: request.sessionUid,
        };
        const internal = {
            summary,
            outputs: [],
        };
        this.terminals.set(terminalId, internal);
        this.emitSession(summary);
        try {
            const ptyProcess = pty.spawn(spec.shell, spec.shellArgs, {
                name: 'xterm-color',
                cwd: request.cwd,
                cols: spec.cols,
                rows: spec.rows,
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                },
            });
            internal.ptyProcess = ptyProcess;
            ptyProcess.onData((data) => {
                this.appendOutput(terminalId, data);
            });
            ptyProcess.onExit(({ exitCode }) => {
                this.updateSession(terminalId, {
                    status: exitCode === 0 ? 'closed' : 'failed',
                    exitCode,
                    endedAtMs: Date.now(),
                });
            });
            this.updateSession(terminalId, { status: 'open' });
            this.appendOutput(terminalId, `\r\n[cli-run-ui] Starting ${spec.displayCommand.join(' ')}\r\n`);
            setTimeout(() => {
                const terminal = this.terminals.get(terminalId);
                terminal?.ptyProcess?.write(`${spec.initialCommand}\r`);
                const bootPrompt = request.bootPrompt?.trim();
                if (bootPrompt) {
                    setTimeout(() => {
                        this.appendOutput(terminalId, `\r\n[cli-run-ui] Sending boot prompt.\r\n`);
                        terminal?.ptyProcess?.write(`${bootPrompt}\r`);
                    }, 700);
                }
            }, 80);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.updateSession(terminalId, {
                status: 'failed',
                error: message,
                endedAtMs: Date.now(),
            });
            this.appendOutput(terminalId, `\r\n[cli-run-ui] Failed to start terminal: ${message}\r\n`);
        }
        return this.terminals.get(terminalId).summary;
    }
    write(terminalId, input) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal?.ptyProcess)
            return null;
        terminal.ptyProcess.write(input);
        return terminal.summary;
    }
    resize(terminalId, cols, rows) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal?.ptyProcess)
            return null;
        terminal.ptyProcess.resize(cols, rows);
        this.updateSession(terminalId, { cols, rows });
        return terminal.summary;
    }
    stop(terminalId) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal)
            return null;
        if (!terminal.ptyProcess || terminal.summary.status === 'closed' || terminal.summary.status === 'failed') {
            return terminal.summary;
        }
        terminal.ptyProcess.kill();
        this.updateSession(terminalId, {
            status: 'closed',
            endedAtMs: Date.now(),
        });
        return terminal.summary;
    }
    updateSession(terminalId, patch) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal)
            return;
        terminal.summary = { ...terminal.summary, ...patch };
        this.emitSession(terminal.summary);
    }
    appendOutput(terminalId, data) {
        const terminal = this.terminals.get(terminalId);
        if (!terminal)
            return;
        const output = {
            id: randomUUID(),
            terminalId,
            data,
            timestampMs: Date.now(),
        };
        terminal.outputs.push(output);
        if (terminal.outputs.length > 2000) {
            terminal.outputs.splice(0, terminal.outputs.length - 2000);
        }
        for (const listener of this.outputListeners) {
            listener(output);
        }
    }
    emitSession(session) {
        for (const listener of this.sessionListeners) {
            listener(session);
        }
    }
    restore(restoredSessions) {
        const restoredAtMs = Date.now();
        for (const entry of restoredSessions) {
            const summary = normalizeRestoredTerminal(entry.summary, restoredAtMs);
            const outputs = normalizeTerminalOutputs(entry.outputs, summary.id);
            if (summary.status === 'closed' && wasActiveTerminal(entry.summary.status)) {
                outputs.push({
                    id: randomUUID(),
                    terminalId: summary.id,
                    data: '\r\n[cli-run-ui] Restored after server restart. The original PTY is no longer attached.\r\n',
                    timestampMs: restoredAtMs,
                });
            }
            this.terminals.set(summary.id, {
                summary,
                outputs,
            });
        }
    }
}
function buildTerminalSpec(request) {
    if (!path.isAbsolute(request.cwd)) {
        throw new Error('A valid absolute working directory is required.');
    }
    const cols = clampDimension(request.cols, 120);
    const rows = clampDimension(request.rows, 32);
    const displayCommand = buildTerminalProviderCommand(request.provider, request.mode, request.sessionUid);
    if (os.platform() === 'win32') {
        return {
            shell: process.env.COMSPEC ?? 'powershell.exe',
            shellArgs: [],
            initialCommand: toWindowsCommand(displayCommand),
            displayCommand,
            cols,
            rows,
        };
    }
    return {
        shell: process.env.SHELL ?? '/bin/bash',
        shellArgs: ['-i'],
        initialCommand: toPosixCommand(displayCommand),
        displayCommand,
        cols,
        rows,
    };
}
function buildTerminalProviderCommand(provider, mode, sessionUid) {
    if (provider === 'codex') {
        const command = resolveProviderCliCommand(provider).command;
        if (mode === 'resume') {
            const sessionId = extractSessionId(provider, sessionUid);
            return [command, '--resume', sessionId];
        }
        return [command];
    }
    if (provider === 'claude') {
        const command = resolveProviderCliCommand(provider).command;
        if (mode === 'resume') {
            const sessionId = extractSessionId(provider, sessionUid);
            return [command, '--resume', sessionId];
        }
        return [command];
    }
    throw new Error(`Unsupported provider: ${provider}`);
}
function extractSessionId(provider, sessionUid) {
    if (!sessionUid) {
        throw new Error('A session is required for resume mode.');
    }
    const [sessionProvider, sessionId] = sessionUid.split(':');
    if (sessionProvider !== provider || !sessionId) {
        throw new Error('Selected session does not match the chosen provider.');
    }
    return sessionId;
}
function clampDimension(value, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.max(20, Math.round(value));
}
function toWindowsCommand(parts) {
    return parts.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
}
function toPosixCommand(parts) {
    return parts.map((part) => `'${part.replace(/'/g, `'\\''`)}'`).join(' ');
}
function normalizeRestoredTerminal(summary, restoredAtMs) {
    const status = wasActiveTerminal(summary.status) ? 'closed' : summary.status;
    return {
        ...summary,
        status,
        startedAtMs: summary.startedAtMs ?? summary.createdAtMs,
        endedAtMs: status === 'closed' ? summary.endedAtMs ?? restoredAtMs : summary.endedAtMs,
    };
}
function normalizeTerminalOutputs(outputs, terminalId) {
    return outputs
        .filter((entry) => entry.terminalId === terminalId)
        .slice(-2000);
}
function wasActiveTerminal(status) {
    return status === 'starting' || status === 'open';
}
//# sourceMappingURL=TerminalManager.js.map