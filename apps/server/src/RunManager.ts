import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  ProviderId,
  RunLogEntryDTO,
  RunSessionDTO,
  StartRunRequestDTO,
} from '@cli-run-ui/core';

type RunListener = (run: RunSessionDTO) => void;
type RunLogListener = (entry: RunLogEntryDTO) => void;

export interface PersistedRunRecord {
  summary: RunSessionDTO;
  logs: RunLogEntryDTO[];
}

interface InternalRun extends PersistedRunRecord {
  child?: ChildProcessWithoutNullStreams;
}

export class RunManager {
  private readonly runs = new Map<string, InternalRun>();
  private readonly runListeners = new Set<RunListener>();
  private readonly logListeners = new Set<RunLogListener>();

  constructor(restoredRuns: PersistedRunRecord[] = []) {
    this.restore(restoredRuns);
  }

  listRuns(): RunSessionDTO[] {
    return Array.from(this.runs.values())
      .map((run) => run.summary)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  getRun(runId: string): RunSessionDTO | null {
    return this.runs.get(runId)?.summary ?? null;
  }

  getLogs(runId: string): RunLogEntryDTO[] {
    return this.runs.get(runId)?.logs ?? [];
  }

  listPersistedRuns(): PersistedRunRecord[] {
    return Array.from(this.runs.values())
      .map((run) => ({
        summary: run.summary,
        logs: [...run.logs],
      }))
      .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs);
  }

  onRun(listener: RunListener): () => void {
    this.runListeners.add(listener);
    return () => this.runListeners.delete(listener);
  }

  onLog(listener: RunLogListener): () => void {
    this.logListeners.add(listener);
    return () => this.logListeners.delete(listener);
  }

  async startRun(request: StartRunRequestDTO): Promise<RunSessionDTO> {
    const startedAtMs = Date.now();
    const runId = randomUUID();
    const spec = buildCommand(request);
    const summary: RunSessionDTO = {
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

    const internal: InternalRun = { summary, logs: [] };
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateRun(runId, {
        status: 'failed',
        error: message,
        endedAtMs: Date.now(),
      });
      this.appendLog(runId, 'system', `Failed to start: ${message}`);
    }

    return this.runs.get(runId)!.summary;
  }

  stopRun(runId: string): RunSessionDTO | null {
    const run = this.runs.get(runId);
    if (!run) return null;
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

  private updateRun(runId: string, patch: Partial<RunSessionDTO>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.summary = { ...run.summary, ...patch };
    this.emitRun(run.summary);
  }

  private appendLog(runId: string, stream: RunLogEntryDTO['stream'], text: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const entry: RunLogEntryDTO = {
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

  private emitRun(summary: RunSessionDTO): void {
    for (const listener of this.runListeners) {
      listener(summary);
    }
  }

  private restore(restoredRuns: PersistedRunRecord[]): void {
    const restoredAtMs = Date.now();
    for (const entry of restoredRuns) {
      const summary = normalizeRestoredRun(entry.summary, restoredAtMs);
      const logs = normalizeRunLogs(entry.logs, summary.id);

      if (summary.status === 'stopped' && wasActiveRun(entry.summary.status)) {
        logs.push({
          id: randomUUID(),
          runId: summary.id,
          stream: 'system',
          text: '[cli-run-ui] Restored after server restart. The original process is no longer attached.',
          timestampMs: restoredAtMs,
        });
      }

      this.runs.set(summary.id, {
        summary,
        logs,
      });
    }
  }
}

function buildCommand(request: StartRunRequestDTO): { command: string; args: string[] } {
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

function extractSessionId(provider: ProviderId, sessionUid?: string): string {
  if (!sessionUid) {
    throw new Error('A session is required for resume mode.');
  }
  const [sessionProvider, sessionId] = sessionUid.split(':');
  if (sessionProvider !== provider || !sessionId) {
    throw new Error('Selected session does not match the chosen provider.');
  }
  return sessionId;
}

function normalizeRestoredRun(summary: RunSessionDTO, restoredAtMs: number): RunSessionDTO {
  const status = wasActiveRun(summary.status) ? 'stopped' : summary.status;
  return {
    ...summary,
    status,
    startedAtMs: summary.startedAtMs ?? summary.createdAtMs,
    endedAtMs: status === 'stopped' ? summary.endedAtMs ?? restoredAtMs : summary.endedAtMs,
  };
}

function normalizeRunLogs(logs: RunLogEntryDTO[], runId: string): RunLogEntryDTO[] {
  return logs
    .filter((entry) => entry.runId === runId)
    .slice(-800);
}

function wasActiveRun(status: RunSessionDTO['status']): boolean {
  return status === 'starting' || status === 'running';
}
