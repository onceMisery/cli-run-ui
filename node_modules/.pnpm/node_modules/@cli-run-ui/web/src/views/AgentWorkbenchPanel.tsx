import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  RunSessionDTO,
  SessionDTO,
  StartRunRequestDTO,
  StartTerminalRequestDTO,
  TerminalSessionDTO,
} from '@cli-run-ui/core';
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import type { Terminal as XTermTerminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  Command,
  LoaderCircle,
  Monitor,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  SquareTerminal,
} from 'lucide-react';

import type { StreamStatus } from '@/hooks/useSessionStream';
import { useRunStream } from '@/hooks/useRunStream';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type LaunchSurface = 'run' | 'terminal';

interface AgentWorkbenchPanelProps {
  activeSession: SessionDTO | null;
  runs: RunSessionDTO[];
  runStatus: StreamStatus;
  terminals: TerminalSessionDTO[];
  terminalStatus: StreamStatus;
}

interface WorkbenchPreferences {
  surface: LaunchSurface;
  provider: SessionDTO['provider'];
  mode: 'task' | 'resume';
  cwd: string;
  prompt: string;
  selectedRunId: string | null;
  selectedTerminalId: string | null;
}

const WORKBENCH_STORAGE_KEY = 'cli-run-ui.agent-workbench';

export function AgentWorkbenchPanel({
  activeSession,
  runs,
  runStatus,
  terminals,
  terminalStatus,
}: AgentWorkbenchPanelProps) {
  const { isChinese } = useI18n();
  const savedPreferences = useMemo(readWorkbenchPreferences, []);
  const [surface, setSurface] = useState<LaunchSurface>(savedPreferences?.surface ?? 'run');
  const [provider, setProvider] = useState<SessionDTO['provider']>(
    savedPreferences?.provider ?? activeSession?.provider ?? 'codex'
  );
  const [mode, setMode] = useState<'task' | 'resume'>(
    savedPreferences?.mode ?? (activeSession ? 'resume' : 'task')
  );
  const [cwd, setCwd] = useState(savedPreferences?.cwd ?? activeSession?.projectPath ?? '');
  const [prompt, setPrompt] = useState(savedPreferences?.prompt ?? '');
  const [runError, setRunError] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [isLaunchingRun, setIsLaunchingRun] = useState(false);
  const [isLaunchingTerminal, setIsLaunchingTerminal] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    savedPreferences?.selectedRunId ?? runs[0]?.id ?? null
  );
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(
    savedPreferences?.selectedTerminalId ?? terminals[0]?.id ?? null
  );

  useEffect(() => {
    if (!activeSession) return;
    setProvider(activeSession.provider);
    setMode('resume');
    if (activeSession.projectPath) {
      setCwd(activeSession.projectPath);
    }
  }, [activeSession?.projectPath, activeSession?.provider, activeSession?.uid]);

  useEffect(() => {
    writeWorkbenchPreferences({
      surface,
      provider,
      mode,
      cwd,
      prompt,
      selectedRunId,
      selectedTerminalId,
    });
  }, [cwd, mode, prompt, provider, selectedRunId, selectedTerminalId, surface]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }
    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(runs[0]?.id ?? null);
  }, [runs, selectedRunId]);

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

  const run = useMemo(
    () => runs.find((entry) => entry.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );
  const terminal = useMemo(
    () => terminals.find((entry) => entry.id === selectedTerminalId) ?? null,
    [selectedTerminalId, terminals]
  );

  const { run: liveRun, logs } = useRunStream(selectedRunId, run);
  const { terminal: liveTerminal, outputs } = useTerminalStream(
    selectedTerminalId,
    terminal
  );

  const canResume =
    !!activeSession &&
    activeSession.provider === provider &&
    !!activeSession.sessionId;
  const canLaunchRun =
    !isLaunchingRun &&
    cwd.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (mode === 'task' || canResume);
  const canLaunchTerminal =
    !isLaunchingTerminal &&
    cwd.trim().length > 0 &&
    (mode === 'task' || canResume);

  const presets = useMemo(
    () => buildPresets(activeSession, provider, isChinese),
    [activeSession, isChinese, provider]
  );

  const launchRun = async () => {
    if (!canLaunchRun) return;
    setIsLaunchingRun(true);
    setRunError(null);
    try {
      const payload: StartRunRequestDTO = {
        provider,
        mode,
        cwd: cwd.trim(),
        prompt: prompt.trim(),
        sessionUid: mode === 'resume' ? activeSession?.uid : undefined,
      };
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { run?: RunSessionDTO; error?: string };
      if (!response.ok || !data.run) {
        throw new Error(data.error ?? 'Failed to start run.');
      }
      startTransition(() => {
        setSurface('run');
        setSelectedRunId(data.run.id);
      });
    } catch (reason) {
      setRunError(reason instanceof Error ? reason.message : 'Failed to start run.');
    } finally {
      setIsLaunchingRun(false);
    }
  };

  const launchTerminal = async () => {
    if (!canLaunchTerminal) return;
    setIsLaunchingTerminal(true);
    setTerminalError(null);
    try {
      const payload: StartTerminalRequestDTO = {
        provider,
        mode: mode === 'resume' ? 'resume' : 'new',
        cwd: cwd.trim(),
        sessionUid: mode === 'resume' ? activeSession?.uid : undefined,
        bootPrompt: prompt.trim() || undefined,
        cols: 120,
        rows: 32,
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
        throw new Error(data.error ?? 'Failed to open terminal.');
      }
      startTransition(() => {
        setSurface('terminal');
        setSelectedTerminalId(data.terminal.id);
      });
    } catch (reason) {
      setTerminalError(reason instanceof Error ? reason.message : 'Failed to open terminal.');
    } finally {
      setIsLaunchingTerminal(false);
    }
  };

  const resetDraft = () => {
    setPrompt('');
    setRunError(null);
    setTerminalError(null);
    setProvider(activeSession?.provider ?? 'codex');
    setMode(activeSession ? 'resume' : 'task');
    setCwd(activeSession?.projectPath ?? '');
    setSurface('run');
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="h-4 w-4 text-cyan-300" />
            {isChinese ? 'Agent 工作台' : 'Agent Workspace'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {isChinese
              ? '统一管理 headless run 与 interactive terminal，自动跟随当前会话并记住本地草稿。'
              : 'Unified controls for headless runs and interactive terminals, synced to the active session and remembered locally.'}
          </div>
        </div>
        <div className="flex gap-2">
          <Badge className={streamBadgeClass(runStatus)}>
            {isChinese ? 'runs' : 'runs'} {runStatus === 'open' ? (isChinese ? '实时' : 'live') : isChinese ? '同步中' : 'syncing'}
          </Badge>
          <Badge className={streamBadgeClass(terminalStatus)}>
            {isChinese ? 'terminals' : 'terminals'}{' '}
            {terminalStatus === 'open' ? (isChinese ? '实时' : 'live') : isChinese ? '同步中' : 'syncing'}
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '启动' : 'Launch'}
              </div>
              <button
                onClick={resetDraft}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {isChinese ? '重置草稿' : 'Reset draft'}
              </button>
            </div>

            <div className="mt-3 flex gap-2">
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
            <div className="mt-2 flex gap-2">
              <ModeChip
                active={mode === 'task'}
                onClick={() => setMode('task')}
                label={isChinese ? '新任务' : 'New task'}
              />
              <ModeChip
                active={mode === 'resume'}
                onClick={() => setMode('resume')}
                label={isChinese ? '恢复' : 'Resume'}
                disabled={!canResume}
              />
            </div>

            <label className="mt-3 block">
              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '工作区' : 'Workspace'}
              </div>
              <input
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder="D:\\code\\your-project"
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </label>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                <span>{isChinese ? '提示词' : 'Prompt'}</span>
                {mode === 'resume' && activeSession ? (
                  <span className="normal-case tracking-normal text-slate-400">
                    {isChinese ? '会话' : 'session'} {activeSession.sessionId}
                  </span>
                ) : (
                  <span className="normal-case tracking-normal text-slate-400">
                    {isChinese ? '已保存到本地' : 'saved locally'}
                  </span>
                )}
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                placeholder={
                  isChinese
                    ? '继续实现、解释改动，或者审查当前代码。'
                    : 'Continue implementation, explain changes, or review the current code.'
                }
              />
            </div>

            <div className="mt-3">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                <Command className="h-3.5 w-3.5" />
                {isChinese ? '预设提示词' : 'Prompt presets'}
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => setPrompt(preset.value)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {!canResume && mode === 'resume' ? (
              <InlineNotice tone="warn">
                {isChinese
                  ? '请先选择同一 provider 的会话，再尝试恢复。'
                  : 'Select a session from the same provider before trying to resume it.'}
              </InlineNotice>
            ) : null}
            {runError ? <InlineNotice tone="error">{runError}</InlineNotice> : null}
            {terminalError ? <InlineNotice tone="error">{terminalError}</InlineNotice> : null}

            <div className="mt-4 grid gap-2">
              <Button
                onClick={() => void launchRun()}
                disabled={!canLaunchRun}
                className="w-full rounded-xl bg-cyan-400 text-slate-950 hover:bg-cyan-300"
              >
                {isLaunchingRun ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isChinese ? '启动 headless run' : 'Start headless run'}
              </Button>
              <Button
                onClick={() => void launchTerminal()}
                disabled={!canLaunchTerminal}
                className="w-full rounded-xl bg-emerald-400 text-slate-950 hover:bg-emerald-300"
              >
                {isLaunchingTerminal ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Monitor className="h-4 w-4" />
                )}
                {isChinese ? '打开交互式终端' : 'Open interactive terminal'}
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '活动历史' : 'Activity history'}
              </div>
              <Badge variant="muted" className="bg-white/5 text-slate-300">
                {runs.length + terminals.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {runs.slice(0, 4).map((entry) => (
                <PickerRow
                  key={entry.id}
                  active={entry.id === selectedRunId && surface === 'run'}
                  label={`${entry.provider} ${entry.mode === 'resume' ? 'resume' : 'task'}`}
                  sublabel={entry.cwd}
                  badge={entry.status}
                  badgeClass={runBadgeClass(entry.status)}
                  onClick={() => {
                    setSurface('run');
                    setSelectedRunId(entry.id);
                  }}
                />
              ))}
              {terminals.slice(0, 4).map((entry) => (
                <PickerRow
                  key={entry.id}
                  active={entry.id === selectedTerminalId && surface === 'terminal'}
                  label={`${entry.provider} ${entry.mode}`}
                  sublabel={entry.cwd}
                  badge={entry.status}
                  badgeClass={terminalBadgeClass(entry.status)}
                  onClick={() => {
                    setSurface('terminal');
                    setSelectedTerminalId(entry.id);
                  }}
                />
              ))}
              {runs.length === 0 && terminals.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-5 text-sm text-slate-400">
                  {isChinese
                    ? '还没有活动记录，先启动一个 run 或 terminal 吧。'
                    : 'No activity yet. Launch a run or terminal to begin.'}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <SurfaceChip
              active={surface === 'run'}
              onClick={() => setSurface('run')}
              icon={Play}
              label={isChinese ? 'Headless run' : 'Headless run'}
            />
            <SurfaceChip
              active={surface === 'terminal'}
              onClick={() => setSurface('terminal')}
              icon={Monitor}
              label={isChinese ? '交互式终端' : 'Interactive terminal'}
            />
          </div>

          {surface === 'run' ? (
            <HeadlessRunPane
              run={liveRun}
              logs={logs}
              onPick={setSelectedRunId}
              onStop={stopRun}
              runs={runs}
            />
          ) : (
            <InteractiveTerminalPane
              terminal={liveTerminal}
              terminals={terminals}
              outputs={outputs}
              selectedTerminalId={selectedTerminalId}
              onPick={setSelectedTerminalId}
              onStop={stopTerminal}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function HeadlessRunPane({
  run,
  runs,
  logs,
  onPick,
  onStop,
}: {
  run: RunSessionDTO | null;
  runs: RunSessionDTO[];
  logs: { id: string; text: string; stream: 'stdout' | 'stderr' | 'system'; timestampMs: number }[];
  onPick: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const { isChinese } = useI18n();
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {isChinese ? '控制台' : 'Console'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {run ? `${run.provider} - ${run.status}` : isChinese ? '选择一个 run' : 'Select a run'}
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
            {isChinese ? '停止' : 'Stop'}
          </Button>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className="h-[320px] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-3"
      >
        {logs.length === 0 ? (
          <div className="text-sm text-slate-500">
            {isChinese
              ? '启动一个 headless run 后，这里会显示输出。'
              : 'Launch a headless run to see output here.'}
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

      <div className="mt-3 space-y-2">
        {runs.slice(0, 5).map((entry) => (
          <PickerRow
            key={entry.id}
            active={entry.id === run?.id}
            label={`${entry.provider} ${entry.mode === 'resume' ? 'resume' : 'task'}`}
            sublabel={entry.command.join(' ')}
            badge={entry.status}
            badgeClass={runBadgeClass(entry.status)}
            onClick={() => onPick(entry.id)}
          />
        ))}
      </div>
    </section>
  );
}

function InteractiveTerminalPane({
  terminal,
  terminals,
  outputs,
  selectedTerminalId,
  onPick,
  onStop,
}: {
  terminal: TerminalSessionDTO | null;
  terminals: TerminalSessionDTO[];
  outputs: { id: string; data: string }[];
  selectedTerminalId: string | null;
  onPick: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const { isChinese } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTermTerminal | null>(null);
  const fitRef = useRef<XTermFitAddon | null>(null);
  const renderedCountRef = useRef(0);
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      ([xtermModule, fitModule]) => {
        if (disposed) return;
        const xterm = new xtermModule.Terminal({
          convertEol: true,
          cursorBlink: true,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 12,
          lineHeight: 1.35,
          theme: {
            background: '#07111b',
            foreground: '#d7e4f6',
            cursor: '#67e8f9',
          },
        });
        const fitAddon = new fitModule.FitAddon();
        xterm.loadAddon(fitAddon);
        xterm.open(host);
        fitAddon.fit();

        xterm.onData((data) => {
          if (!selectedTerminalId) return;
          bufferRef.current += data;
          if (timerRef.current) return;
          timerRef.current = setTimeout(() => {
            const nextInput = bufferRef.current;
            bufferRef.current = '';
            timerRef.current = null;
            void sendTerminalInput(selectedTerminalId, nextInput);
          }, 20);
        });

        resizeObserver = new ResizeObserver(() => {
          fitAddon.fit();
          if (!selectedTerminalId) return;
          void resizeTerminal(selectedTerminalId, xterm.cols, xterm.rows);
        });
        resizeObserver.observe(host);

        termRef.current = xterm;
        fitRef.current = fitAddon;
      }
    );

    return () => {
      disposed = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      bufferRef.current = '';
      renderedCountRef.current = 0;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [selectedTerminalId]);

  useEffect(() => {
    termRef.current?.reset();
    renderedCountRef.current = 0;
  }, [selectedTerminalId]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const nextOutputs = outputs.slice(renderedCountRef.current);
    for (const entry of nextOutputs) {
      term.write(entry.data);
    }
    renderedCountRef.current = outputs.length;
  }, [outputs]);

  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !selectedTerminalId) return;
    fit.fit();
    void resizeTerminal(selectedTerminalId, term.cols, term.rows);
  }, [selectedTerminalId]);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {isChinese ? '终端' : 'Terminal'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {terminal
              ? `${terminal.provider} - ${terminal.status}`
              : isChinese
                ? '选择一个终端会话'
                : 'Select a terminal session'}
          </div>
        </div>
        {terminal && terminal.status === 'open' ? (
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
            onClick={() => void onStop(terminal.id)}
          >
            <SquareTerminal className="h-4 w-4" />
            {isChinese ? '停止' : 'Stop'}
          </Button>
        ) : null}
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#07111b] p-2">
        <div ref={hostRef} className="h-[320px] overflow-hidden rounded-xl" />
      </div>

      <div className="mt-3 space-y-2">
        {terminals.slice(0, 5).map((entry) => (
          <PickerRow
            key={entry.id}
            active={entry.id === terminal?.id}
            label={`${entry.provider} ${entry.mode}`}
            sublabel={entry.command.join(' ')}
            badge={entry.status}
            badgeClass={terminalBadgeClass(entry.status)}
            onClick={() => onPick(entry.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PickerRow({
  active,
  label,
  sublabel,
  badge,
  badgeClass,
  onClick,
}: {
  active: boolean;
  label: string;
  sublabel: string;
  badge: string;
  badgeClass: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border px-3 py-2 text-left transition',
        active
          ? 'border-cyan-300/30 bg-cyan-300/10'
          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.08]'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{label}</div>
          <div className="mt-1 truncate text-xs text-slate-400">{sublabel}</div>
        </div>
        <Badge className={badgeClass}>{badge}</Badge>
      </div>
    </button>
  );
}

function SurfaceChip({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Play;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition',
        active
          ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-50'
          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
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

function InlineNotice({
  tone,
  children,
}: {
  tone: 'warn' | 'error';
  children: string;
}) {
  return (
    <div
      className={cn(
        'mt-3 rounded-xl border px-3 py-2 text-sm',
        tone === 'warn'
          ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
          : 'border-rose-400/20 bg-rose-400/10 text-rose-100'
      )}
    >
      {children}
    </div>
  );
}

async function stopRun(runId: string) {
  await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
}

async function stopTerminal(terminalId: string) {
  await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/stop`, { method: 'POST' });
}

async function sendTerminalInput(terminalId: string, input: string) {
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

function buildPresets(
  activeSession: SessionDTO | null,
  provider: SessionDTO['provider'],
  isChinese: boolean
) {
  const projectLabel = activeSession?.projectName ?? (isChinese ? '当前工作区' : 'this workspace');
  const sessionHint = activeSession
    ? isChinese
      ? `继续当前的 ${activeSession.provider} 会话。`
      : `Continue the existing ${activeSession.provider} session.`
    : '';
  return [
    {
      label: isChinese ? '继续实现' : 'Continue build',
      value: isChinese
        ? `${sessionHint}继续推进 ${projectLabel} 的下一部分实现，直接修改代码，完成后简要总结结果。`
        : `${sessionHint} Continue implementing the next slice in ${projectLabel}, make code changes directly, then summarize the outcome.`,
    },
    {
      label: isChinese ? '审查风险' : 'Review risks',
      value: isChinese
        ? `审查 ${projectLabel} 的最新改动，重点关注 bug、行为回归和缺失的测试，并优先报告发现。`
        : `Review the latest changes in ${projectLabel}, focus on bugs, regressions, and missing tests, and report findings first.`,
    },
    {
      label: isChinese ? '修复失败' : 'Fix failures',
      value: isChinese
        ? `排查 ${projectLabel} 当前的构建或测试失败，完整修复后说明改动内容。`
        : `Investigate the current build or test failures in ${projectLabel}, fix them end-to-end, and explain what changed.`,
    },
    {
      label: isChinese
        ? provider === 'codex'
          ? 'Codex 交接'
          : 'Claude 交接'
        : provider === 'codex'
          ? 'Codex handoff'
          : 'Claude handoff',
      value: isChinese
        ? `接手 ${projectLabel} 当前最值得推进的下一项任务，保持现有模式，并在完成后留下简洁交接说明。`
        : `Pick up the next best task in ${projectLabel}, preserve existing patterns, and leave a concise handoff note when done.`,
    },
  ];
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

function terminalBadgeClass(status: TerminalSessionDTO['status']) {
  if (status === 'open' || status === 'starting') {
    return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  }
  if (status === 'failed') {
    return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
  }
  return 'border-slate-400/20 bg-slate-400/10 text-slate-200';
}

function logClass(stream: 'stdout' | 'stderr' | 'system') {
  if (stream === 'stderr') return 'text-rose-100';
  if (stream === 'system') return 'text-cyan-200';
  return 'text-slate-200';
}

function readWorkbenchPreferences(): WorkbenchPreferences | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(WORKBENCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkbenchPreferences>;
    if (!isLaunchSurface(parsed.surface)) return null;
    if (parsed.provider !== 'claude' && parsed.provider !== 'codex') return null;
    if (parsed.mode !== 'task' && parsed.mode !== 'resume') return null;

    return {
      surface: parsed.surface,
      provider: parsed.provider,
      mode: parsed.mode,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : '',
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      selectedRunId: typeof parsed.selectedRunId === 'string' ? parsed.selectedRunId : null,
      selectedTerminalId:
        typeof parsed.selectedTerminalId === 'string' ? parsed.selectedTerminalId : null,
    };
  } catch {
    return null;
  }
}

function writeWorkbenchPreferences(preferences: WorkbenchPreferences) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage failures and keep the workspace usable.
  }
}

function isLaunchSurface(value: unknown): value is LaunchSurface {
  return value === 'run' || value === 'terminal';
}
