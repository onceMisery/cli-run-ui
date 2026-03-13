import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  SessionDTO,
  StartTerminalRequestDTO,
  TerminalSessionDTO,
} from '@cli-run-ui/core';
import { LoaderCircle, Monitor, Play, SquareTerminal } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import type { StreamStatus } from '@/hooks/useSessionStream';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TerminalPanelProps {
  activeSession: SessionDTO | null;
  terminals: TerminalSessionDTO[];
  terminalStatus: StreamStatus;
}

export function TerminalPanel({
  activeSession,
  terminals,
  terminalStatus,
}: TerminalPanelProps) {
  const [provider, setProvider] = useState<SessionDTO['provider']>(
    activeSession?.provider ?? 'codex'
  );
  const [mode, setMode] = useState<'new' | 'resume'>(activeSession ? 'resume' : 'new');
  const [cwd, setCwd] = useState(activeSession?.projectPath ?? '');
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(
    terminals[0]?.id ?? null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef('');
  const inputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renderedOutputCountRef = useRef(0);

  useEffect(() => {
    setProvider(activeSession?.provider ?? 'codex');
    setMode(activeSession ? 'resume' : 'new');
    setCwd(activeSession?.projectPath ?? '');
  }, [activeSession?.provider, activeSession?.projectPath, activeSession?.uid]);

  useEffect(() => {
    if (terminals.length === 0) {
      setSelectedTerminalId(null);
      return;
    }
    if (selectedTerminalId && terminals.some((terminal) => terminal.id === selectedTerminalId)) {
      return;
    }
    setSelectedTerminalId(terminals[0]?.id ?? null);
  }, [selectedTerminalId, terminals]);

  const selectedTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === selectedTerminalId) ?? null,
    [selectedTerminalId, terminals]
  );
  const { terminal, outputs, status } = useTerminalStream(selectedTerminalId, selectedTerminal);

  const canResume =
    !!activeSession &&
    activeSession.provider === provider &&
    !!activeSession.sessionId;

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      theme: {
        background: '#07111b',
        foreground: '#d7e4f6',
        cursor: '#67e8f9',
        black: '#08111c',
        red: '#fb7185',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#f472b6',
        cyan: '#67e8f9',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#fda4af',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#f9a8d4',
        brightCyan: '#a5f3fc',
        brightWhite: '#f8fafc',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    fitAddon.fit();

    term.onData((data) => {
      if (!selectedTerminalId) return;
      inputBufferRef.current += data;
      if (inputTimerRef.current) return;
      inputTimerRef.current = setTimeout(() => {
        const input = inputBufferRef.current;
        inputBufferRef.current = '';
        inputTimerRef.current = null;
        void sendInput(selectedTerminalId, input);
      }, 20);
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      if (!selectedTerminalId) return;
      void resizeTerminal(selectedTerminalId, term.cols, term.rows);
    });
    observer.observe(host);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    return () => {
      observer.disconnect();
      if (inputTimerRef.current) clearTimeout(inputTimerRef.current);
      inputTimerRef.current = null;
      inputBufferRef.current = '';
      renderedOutputCountRef.current = 0;
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [selectedTerminalId]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.reset();
    renderedOutputCountRef.current = 0;
  }, [selectedTerminalId]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (renderedOutputCountRef.current > outputs.length) {
      term.reset();
      renderedOutputCountRef.current = 0;
    }
    const nextOutputs = outputs.slice(renderedOutputCountRef.current);
    for (const chunk of nextOutputs) {
      term.write(chunk.data);
    }
    renderedOutputCountRef.current = outputs.length;
  }, [outputs]);

  useEffect(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon || !selectedTerminalId) return;
    fitAddon.fit();
    const term = xtermRef.current;
    if (!term) return;
    void resizeTerminal(selectedTerminalId, term.cols, term.rows);
  }, [selectedTerminalId, terminalHostRef]);

  const startTerminal = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const cols = xtermRef.current?.cols ?? 120;
      const rows = xtermRef.current?.rows ?? 32;
      const payload: StartTerminalRequestDTO = {
        provider,
        mode,
        cwd: cwd.trim(),
        sessionUid: mode === 'resume' ? activeSession?.uid : undefined,
        cols,
        rows,
      };
      const response = await fetch('/api/terminals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        terminal?: TerminalSessionDTO;
        error?: string;
      };
      if (!response.ok || !data.terminal) {
        throw new Error(data.error ?? 'Failed to start terminal.');
      }
      setSelectedTerminalId(data.terminal.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to start terminal.');
    } finally {
      setSubmitting(false);
    }
  };

  const stopTerminal = async (terminalId: string) => {
    await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/stop`, {
      method: 'POST',
    });
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Monitor className="h-4 w-4 text-emerald-300" />
            Interactive Terminal
          </div>
          <div className="mt-1 text-xs text-slate-400">
            通过 PTY 启动真实 Claude/Codex 终端，更接近 `claude-run` 的交互方式。
          </div>
        </div>
        <Badge className={streamBadgeClass(terminalStatus)}>
          {terminalStatus === 'open'
            ? 'terminal feed live'
            : terminalStatus === 'closed'
              ? 'reconnecting'
              : 'connecting'}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-3">
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
            <ModeChip active={mode === 'new'} onClick={() => setMode('new')} label="New" />
            <ModeChip
              active={mode === 'resume'}
              onClick={() => setMode('resume')}
              label="Resume"
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

          {error ? (
            <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {!canResume && mode === 'resume' ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
              先选中当前 provider 对应的会话，才能以 resume 模式打开终端。
            </div>
          ) : null}

          <Button
            onClick={() => void startTerminal()}
            disabled={submitting || !cwd.trim() || (mode === 'resume' && !canResume)}
            className="w-full rounded-xl bg-emerald-400 text-slate-950 hover:bg-emerald-300"
          >
            {submitting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Open terminal
          </Button>

          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              Sessions
            </div>
            <div className="space-y-2">
              {terminals.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-5 text-sm text-slate-400">
                  No terminal sessions yet.
                </div>
              ) : (
                terminals.slice(0, 6).map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedTerminalId(entry.id)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2 text-left transition',
                      entry.id === selectedTerminalId
                        ? 'border-emerald-300/30 bg-emerald-300/10'
                        : 'border-white/10 bg-black/20 hover:bg-white/[0.05]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {entry.provider} {entry.mode}
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-400">{entry.cwd}</div>
                      </div>
                      <Badge className={terminalBadgeClass(entry.status)}>{entry.status}</Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Terminal</div>
              <div className="mt-1 text-sm text-slate-300">
                {terminal ? `${terminal.provider} · ${terminal.status}` : 'Select a terminal session'}
              </div>
            </div>
            {terminal && terminal.status === 'open' ? (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                onClick={() => void stopTerminal(terminal.id)}
              >
                <SquareTerminal className="h-4 w-4" />
                Stop
              </Button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#07111b] p-2">
            <div
              ref={terminalHostRef}
              className="h-[340px] overflow-hidden rounded-xl"
            />
          </div>

          {terminal?.command?.length ? (
            <div className="mt-2 truncate text-xs text-slate-500">
              {terminal.command.join(' ')}
            </div>
          ) : null}
          <div className="mt-2 text-xs text-slate-500">
            Stream {status === 'open' ? 'connected' : status === 'closed' ? 'reconnecting' : 'connecting'}
          </div>
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
          ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-50'
          : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200',
        disabled && 'cursor-not-allowed opacity-45'
      )}
    >
      {label}
    </button>
  );
}

async function sendInput(terminalId: string, input: string) {
  if (!input) return;
  await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
}

async function resizeTerminal(terminalId: string, cols: number, rows: number) {
  await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/resize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cols, rows }),
  });
}

function streamBadgeClass(status: StreamStatus) {
  return status === 'open'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : status === 'closed'
      ? 'border-rose-400/30 bg-rose-400/10 text-rose-100'
      : 'border-amber-400/30 bg-amber-400/10 text-amber-100';
}

function terminalBadgeClass(status: TerminalSessionDTO['status']) {
  if (status === 'open' || status === 'starting') {
    return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  }
  if (status === 'failed') {
    return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
  }
  return 'border-slate-400/20 bg-slate-400/10 text-slate-200';
}
