import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export class RunManager {
    runs = new Map();
    runListeners = new Set();
    logListeners = new Set();
    listRuns() {
        return Array.from(this.runs.values())
            .map((run) => run.summary)
            .sort((a, b) => b.createdAtMs - a.createdAtMs);
    }
    getRun(runId) {
        return this.runs.get(runId)?.summary ?? null;
    }
    getLogs(runId) {
        return this.runs.get(runId)?.logs ?? [];
    }
    onRun(listener) {
        this.runListeners.add(listener);
        return () => this.runListeners.delete(listener);
    }
    onLog(listener) {
        this.logListeners.add(listener);
        return () => this.logListeners.delete(listener);
    }
    async startRun(request) {
        const startedAtMs = Date.now();
        const runId = randomUUID();
        const spec = buildCommand(request);
        const summary = {
            id: runId,
            provider: request.provider,
            mode: request.mode,
            cwd: request.cwd,
            prompt: request.prompt,
            command: [spec.command, ...spec.args],
            createdAtMs: startedAtMs,
            startedAtMs,
            status: 'starting',
            sessionUid: request.sessionUid,
        };
        const internal = { summary, logs: [] };
        this.runs.set(runId, internal);
        this.emitRun(summary);
        try {
            const child = spawn(spec.command, spec.args, {
                cwd: request.cwd,
                env: {
                    ...process.env,
                    FORCE_COLOR: '0',
                    NO_COLOR: '1',
                },
                stdio: 'pipe',
                shell: false,
            });
            internal.child = child;
            this.updateRun(runId, { status: 'running' });
            this.appendLog(runId, 'system', `Started ${summary.command.join(' ')}`);
            child.stdout.on('data', (chunk) => {
                this.appendLog(runId, 'stdout', chunk.toString('utf8'));
            });
            child.stderr.on('data', (chunk) => {
                this.appendLog(runId, 'stderr', chunk.toString('utf8'));
            });
            child.on('error', (error) => {
                this.updateRun(runId, {
                    status: 'failed',
                    error: error.message,
                    endedAtMs: Date.now(),
                });
                this.appendLog(runId, 'system', `Failed to start: ${error.message}`);
            });
            child.on('close', (exitCode, signal) => {
                const status = signal ? 'stopped' : exitCode === 0 ? 'exited' : 'failed';
                const message = signal
                    ? `Process stopped by signal ${signal}`
                    : `Process exited with code ${exitCode ?? 'unknown'}`;
                this.updateRun(runId, {
                    status,
                    exitCode,
                    endedAtMs: Date.now(),
                });
                this.appendLog(runId, 'system', message);
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.updateRun(runId, {
                status: 'failed',
                error: message,
                endedAtMs: Date.now(),
            });
            this.appendLog(runId, 'system', `Failed to start: ${message}`);
        }
        return this.runs.get(runId).summary;
    }
    stopRun(runId) {
        const run = this.runs.get(runId);
        if (!run)
            return null;
        if (!run.child || run.child.killed || run.summary.status === 'failed' || run.summary.status === 'exited' || run.summary.status === 'stopped') {
            return run.summary;
        }
        run.child.kill();
        this.updateRun(runId, {
            status: 'stopped',
            endedAtMs: Date.now(),
        });
        this.appendLog(runId, 'system', 'Stop requested by cli-run-ui.');
        return run.summary;
    }
    updateRun(runId, patch) {
        const run = this.runs.get(runId);
        if (!run)
            return;
        run.summary = { ...run.summary, ...patch };
        this.emitRun(run.summary);
    }
    appendLog(runId, stream, text) {
        const run = this.runs.get(runId);
        if (!run)
            return;
        const entry = {
            id: randomUUID(),
            runId,
            stream,
            text,
            timestampMs: Date.now(),
        };
        run.logs.push(entry);
        if (run.logs.length > 800) {
            run.logs.splice(0, run.logs.length - 800);
        }
        for (const listener of this.logListeners) {
            listener(entry);
        }
    }
    emitRun(summary) {
        for (const listener of this.runListeners) {
            listener(summary);
        }
    }
}
function buildCommand(request) {
    if (!request.prompt.trim()) {
        throw new Error('Prompt is required.');
    }
    if (!path.isAbsolute(request.cwd)) {
        throw new Error('A valid absolute working directory is required.');
    }
    const provider = request.provider;
    if (provider === 'codex') {
        const command = process.env.CLI_RUN_UI_CODEX_COMMAND ?? 'codex';
        if (request.mode === 'resume') {
            const sessionId = extractSessionId(provider, request.sessionUid);
            return {
                command,
                args: ['exec', '--skip-git-repo-check', 'resume', sessionId, request.prompt],
            };
        }
        return {
            command,
            args: ['exec', '--skip-git-repo-check', request.prompt],
        };
    }
    if (provider === 'claude') {
        const command = process.env.CLI_RUN_UI_CLAUDE_COMMAND ?? 'claude';
        if (request.mode === 'resume') {
            const sessionId = extractSessionId(provider, request.sessionUid);
            return {
                command,
                args: ['--resume', sessionId, '--print', request.prompt],
            };
        }
        return {
            command,
            args: ['--print', request.prompt],
        };
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
//# sourceMappingURL=RunManager.js.map