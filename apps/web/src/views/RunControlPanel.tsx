import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunSessionDTO, SessionDTO, StartRunRequestDTO } from '@cli-run-ui/core';
import { LoaderCircle, Play, Square, Terminal } from 'lucide-react';

import type { StreamStatus } from '@/hooks/useSessionStream';
import { useRunStream } from '@/hooks/useRunStream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RunControlPanelProps {
  activeSession: SessionDTO | null;
  runs: RunSessionDTO[];
  runStatus: StreamStatus;
}

export function RunControlPanel({
  activeSession,
  runs,
  runStatus,
}: RunControlPanelProps) {
  const [provider, setProvider] = useState<SessionDTO['provider']>(
    activeSession?.provider ?? 'codex'
  );
  const [mode, setMode] = useState<'task' | 'resume'>(activeSession ? 'resume' : 'task');
  const [cwd, setCwd] = useState(activeSession?.projectPath ?? '');
  const [prompt, setPrompt] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProvider(activeSession?.provider ?? 'codex');
    setCwd(activeSession?.projectPath ?? '');
    setMode(activeSession ? 'resume' : 'task');
  }, [activeSession?.provider, activeSession?.projectPath, activeSession?.uid]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(runs[0]?.id ?? null);
  }, [runs, selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );
  const { run, logs, status } = useRunStream(selectedRunId, selectedRun);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = logViewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const canResume =
    !!activeSession &&
    activeSession.provider === provider &&
    !!activeSession.sessionId;

  const canStart =
    !submitting &&
    cwd.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (mode === 'task' || canResume);

  const onSubmit = async () => {
    if (!canStart) return;
    setSubmitting(true);
    setError(null);

    const payload: StartRunRequestDTO = {
      provider,
      mode,
      cwd: cwd.trim(),
      prompt: prompt.trim(),
      sessionUid: mode === 'resume' ? activeSession?.uid : undefined,
    };

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { run?: RunSessionDTO; error?: string };
      if (!response.ok || !data.run) {
        throw new Error(data.error ?? 'Failed to start run.');
      }
      setSelectedRunId(data.run.id);
      setPrompt('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to start run.');
    } finally {
      setSubmitting(false);
    }
  };

  const onStop = async (runId: string) => {
    await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
    });
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Terminal className="h-4 w-4 text-cyan-300" />
            Run Console
          </div>
          <div className="mt-1 text-xs text-slate-400">
            启动 Codex 或 Claude 的 headless task，并实时观察输出。
          </div>
        </div>
        <Badge className={streamBadgeClass(runStatus)}>
          {runStatus === 'open' ? 'run feed live' : runStatus === 'closed' ? 'reconnecting' : 'connecting'}
        </Badge>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex gap-2">
          <ModeChip
            active={provider === 'codex'}
            onClick={() => setProvider('codex')}
            label="Codex"
          />
          <ModeChip
            active={provider === 'claude'}
            onClick={() => setProvider('claude')}
            label="Claude"
          />
        </div>

        <div className="flex gap-2">
          <ModeChip active={mode === 'task'} onClick={() => setMode('task')} label="New task" />
          <ModeChip
            active={mode === 'resume'}
            onClick={() => setMode('resume')}
            label="Resume session"
            disabled={!canResume}
          />
        </div>

        <label className="block">
          <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">Workspace</div>
          <input
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            placeholder="D:\\code\\your-project"
          />
        </label>

        <label className="block">
          <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
            <span>Prompt</span>
            {mode === 'resume' && activeSession ? (
              <span className="normal-case tracking-normal text-slate-400">
                Session {activeSession.sessionId}
              </span>
            ) : null}
          </div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
            placeholder={
              provider === 'codex'
                ? 'Implement the next UI/runtime slice and explain the result.'
                : 'Continue this workspace task and summarize the changes.'
            }
          />
        </label>

        {error ? (
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {!canResume && mode === 'resume' ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
            先选择一个与当前 provider 匹配的会话，才能继续该 session。
          </div>
        ) : null}

        <Button
          onClick={onSubmit}
          disabled={!canStart}
          className="w-full rounded-xl bg-cyan-400 text-slate-950 hover:bg-cyan-300"
        >
          {submitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Start run
        </Button>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
          <span>Recent runs</span>
          <span>{runs.length}</span>
        </div>
        <div className="space-y-2">
          {runs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-5 text-sm text-slate-400">
              No runs launched yet.
            </div>
          ) : (
            runs.slice(0, 5).map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedRunId(entry.id)}
                className={cn(
                  'w-full rounded-xl border px-3 py-2 text-left transition',
                  entry.id === selectedRunId
                    ? 'border-cyan-300/30 bg-cyan-300/10'
                    : 'border-white/10 bg-black/20 hover:bg-white/[0.05]'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {entry.provider} {entry.mode === 'resume' ? 'resume' : 'task'}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {entry.cwd}
                    </div>
                  </div>
                  <Badge className={runBadgeClass(entry.status)}>{entry.status}</Badge>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Console</div>
            <div className="mt-1 text-sm text-slate-300">
              {run ? `${run.provider} · ${run.status}` : 'Select a run'}
            </div>
          </div>
          {run && (run.status === 'starting' || run.status === 'running') ? (
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
              onClick={() => void onStop(run.id)}
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : null}
        </div>

        <div
          ref={logViewportRef}
          className="h-[260px] overflow-auto rounded-2xl border border-white/10 bg-black/35 p-3"
        >
          {logs.length === 0 ? (
            <div className="text-sm text-slate-500">
              {selectedRunId ? 'Waiting for run output...' : 'Launch a task to see output here.'}
            </div>
          ) : (
            <div className="space-y-2 font-mono text-xs leading-6">
              {logs.map((entry) => (
                <div key={entry.id} className={logClass(entry.stream)}>
                  <span className="mr-2 text-slate-500">
                    [{new Date(entry.timestampMs).toLocaleTimeString()}]
                  </span>
                  <span className="whitespace-pre-wrap break-words">{entry.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {run?.command?.length ? (
          <div className="mt-2 truncate text-xs text-slate-500">
            {run.command.join(' ')}
          </div>
        ) : null}
        <div className="mt-2 text-xs text-slate-500">
          Stream {status === 'open' ? 'connected' : status === 'closed' ? 'reconnecting' : 'connecting'}
        </div>
      </div>
    </section>
  );
}

function ModeChip({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-50'
          : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200',
        disabled && 'cursor-not-allowed opacity-45'
      )}
    >
      {label}
    </button>
  );
}

function streamBadgeClass(status: StreamStatus) {
  return status === 'open'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : status === 'closed'
      ? 'border-rose-400/30 bg-rose-400/10 text-rose-100'
      : 'border-amber-400/30 bg-amber-400/10 text-amber-100';
}

function runBadgeClass(status: RunSessionDTO['status']) {
  if (status === 'running' || status === 'starting') {
    return 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100';
  }
  if (status === 'failed') {
    return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
  }
  if (status === 'stopped') {
    return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  }
  return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
}

function logClass(stream: 'stdout' | 'stderr' | 'system') {
  if (stream === 'stderr') return 'text-rose-100';
  if (stream === 'system') return 'text-cyan-200';
  return 'text-slate-200';
}
