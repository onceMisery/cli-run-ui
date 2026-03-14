import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AgentRelayParticipantInputDTO,
  AgentRelayInterventionDTO,
  AgentRelaySessionDTO,
  AgentRelayTurnDTO,
  RunSessionDTO,
  SessionDTO,
  StartAgentRelayRequestDTO,
  StartRunRequestDTO,
  StartTerminalRequestDTO,
  TerminalSessionDTO,
} from '@cli-run-ui/core';
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import type { Terminal as XTermTerminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  ArrowUp,
  Copy,
  Command,
  CornerDownLeft,
  Download,
  Keyboard,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Pause,
  Pencil,
  Play,
  SplitSquareVertical,
  RotateCcw,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  Users,
} from 'lucide-react';

import { useAgentRelayStream } from '@/hooks/useAgentRelayStream';
import type { StreamStatus } from '@/hooks/useSessionStream';
import { useRunStream } from '@/hooks/useRunStream';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type LaunchSurface = 'run' | 'terminal' | 'relay';

interface AgentWorkbenchPanelProps {
  activeSession: SessionDTO | null;
  runs: RunSessionDTO[];
  runStatus: StreamStatus;
  terminals: TerminalSessionDTO[];
  terminalStatus: StreamStatus;
  relays: AgentRelaySessionDTO[];
  relayStatus: StreamStatus;
}

interface WorkbenchPreferences {
  surface: LaunchSurface;
  provider: SessionDTO['provider'];
  mode: 'task' | 'resume';
  cwd: string;
  prompt: string;
  relayPrompt: string;
  relaySystemPrompt: string;
  relayStarter: SessionDTO['provider'];
  relayTemplateId: RelayTemplateId;
  relayMaxTurns: number;
  selectedRunId: string | null;
  selectedTerminalId: string | null;
  selectedRelayId: string | null;
}

type RelayTemplateId = 'duel' | 'review-trio' | 'delivery-room';

const WORKBENCH_STORAGE_KEY = 'cli-run-ui.agent-workbench';
const RECENT_CHAT_STORAGE_KEY = 'cli-run-ui.recent-chat-prompts';
const MAX_RECENT_CHAT_PROMPTS = 6;
const RELAY_TEMPLATE_IDS: RelayTemplateId[] = ['duel', 'review-trio', 'delivery-room'];

export function AgentWorkbenchPanel({
  activeSession,
  runs,
  runStatus,
  terminals,
  terminalStatus,
  relays,
  relayStatus,
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
  const [relayPrompt, setRelayPrompt] = useState(savedPreferences?.relayPrompt ?? '');
  const [relaySystemPrompt, setRelaySystemPrompt] = useState(
    savedPreferences?.relaySystemPrompt ?? ''
  );
  const [relayStarter, setRelayStarter] = useState<SessionDTO['provider']>(
    savedPreferences?.relayStarter ?? 'codex'
  );
  const [relayTemplateId, setRelayTemplateId] = useState<RelayTemplateId>(
    savedPreferences?.relayTemplateId ?? 'duel'
  );
  const [relayMaxTurns, setRelayMaxTurns] = useState(savedPreferences?.relayMaxTurns ?? 4);
  const [runError, setRunError] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [isLaunchingRun, setIsLaunchingRun] = useState(false);
  const [isLaunchingTerminal, setIsLaunchingTerminal] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [isLaunchingRelay, setIsLaunchingRelay] = useState(false);
  const [isSendingRelayIntervention, setIsSendingRelayIntervention] = useState(false);
  const [isUpdatingRelayLifecycle, setIsUpdatingRelayLifecycle] = useState(false);
  const [editingRelayInterventionId, setEditingRelayInterventionId] = useState<string | null>(null);
  const [isRemovingRelayIntervention, setIsRemovingRelayIntervention] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [relayInterventionDraft, setRelayInterventionDraft] = useState('');
  const [relayInterventionError, setRelayInterventionError] = useState<string | null>(null);
  const [recentChatPrompts, setRecentChatPrompts] = useState<string[]>(() =>
    readRecentChatPrompts()
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    savedPreferences?.selectedRunId ?? runs[0]?.id ?? null
  );
  const [selectedTerminalId, setSelectedTerminalId] = useState<string | null>(
    savedPreferences?.selectedTerminalId ?? terminals[0]?.id ?? null
  );
  const [selectedRelayId, setSelectedRelayId] = useState<string | null>(
    savedPreferences?.selectedRelayId ?? relays[0]?.id ?? null
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
      relayPrompt,
      relaySystemPrompt,
      relayStarter,
      relayTemplateId,
      relayMaxTurns,
      selectedRunId,
      selectedTerminalId,
      selectedRelayId,
    });
  }, [
    cwd,
    mode,
    prompt,
    relaySystemPrompt,
    provider,
    relayMaxTurns,
    relayPrompt,
    relayStarter,
    relayTemplateId,
    selectedRelayId,
    selectedRunId,
    selectedTerminalId,
    surface,
  ]);

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

  useEffect(() => {
    if (relays.length === 0) {
      setSelectedRelayId(null);
      return;
    }
    if (selectedRelayId && relays.some((relay) => relay.id === selectedRelayId)) return;
    setSelectedRelayId(relays[0]?.id ?? null);
  }, [relays, selectedRelayId]);

  const run = useMemo(
    () => runs.find((entry) => entry.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );
  const terminal = useMemo(
    () => terminals.find((entry) => entry.id === selectedTerminalId) ?? null,
    [selectedTerminalId, terminals]
  );
  const relay = useMemo(
    () => relays.find((entry) => entry.id === selectedRelayId) ?? null,
    [relays, selectedRelayId]
  );

  const { run: liveRun, logs } = useRunStream(selectedRunId, run);
  const { terminal: liveTerminal, outputs } = useTerminalStream(
    selectedTerminalId,
    terminal
  );
  const { relay: liveRelay, turns, interventions } = useAgentRelayStream(selectedRelayId, relay);

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
  const canSendChat =
    !isSendingChat &&
    chatDraft.trim().length > 0 &&
    cwd.trim().length > 0 &&
    (mode === 'task' || canResume);
  const canLaunchRelay =
    !isLaunchingRelay &&
    cwd.trim().length > 0 &&
    relayPrompt.trim().length > 0;
  const relayTemplate = useMemo(
    () => buildRelayTemplate(relayTemplateId, relayStarter, isChinese),
    [isChinese, relayStarter, relayTemplateId]
  );

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

  const startTerminalSession = async (bootPrompt?: string) => {
    const payload: StartTerminalRequestDTO = {
      provider,
      mode: mode === 'resume' ? 'resume' : 'new',
      cwd: cwd.trim(),
      sessionUid: mode === 'resume' ? activeSession?.uid : undefined,
      bootPrompt,
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
    return data.terminal;
  };

  const launchTerminal = async () => {
    if (!canLaunchTerminal) return;
    setIsLaunchingTerminal(true);
    setTerminalError(null);
    try {
      await startTerminalSession(prompt.trim() || undefined);
    } catch (reason) {
      setTerminalError(reason instanceof Error ? reason.message : 'Failed to open terminal.');
    } finally {
      setIsLaunchingTerminal(false);
    }
  };

  const sendChatMessage = async () => {
    if (!canSendChat) return;
    const message = chatDraft.trim();
    setIsSendingChat(true);
    setChatError(null);

    try {
      if (liveTerminal?.status === 'open') {
        await sendTerminalInput(liveTerminal.id, normalizeChatInput(message));
        startTransition(() => setSurface('terminal'));
      } else {
        await startTerminalSession(message);
      }
      const nextRecentPrompts = rememberRecentChatPrompt(recentChatPrompts, message);
      setRecentChatPrompts(nextRecentPrompts);
      writeRecentChatPrompts(nextRecentPrompts);
      setChatDraft('');
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : 'Failed to send message.');
    } finally {
      setIsSendingChat(false);
    }
  };

  const launchRelay = async () => {
    if (!canLaunchRelay) return;
    setIsLaunchingRelay(true);
    setRelayError(null);

    try {
      const payload: StartAgentRelayRequestDTO = {
        cwd: cwd.trim(),
        prompt: relayPrompt.trim(),
        starter: relayTemplate.participants[0]?.provider ?? relayStarter,
        participants: relayTemplate.participants,
        systemPrompt: relaySystemPrompt.trim() || undefined,
        maxTurns: relayMaxTurns,
        title: relayPrompt.trim(),
      };
      const response = await fetch('/api/relays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as {
        relay?: AgentRelaySessionDTO;
        error?: string;
      };
      if (!response.ok || !data.relay) {
        throw new Error(data.error ?? 'Failed to start relay.');
      }
      startTransition(() => {
        setSurface('relay');
        setSelectedRelayId(data.relay.id);
      });
    } catch (reason) {
      setRelayError(reason instanceof Error ? reason.message : 'Failed to start relay.');
    } finally {
      setIsLaunchingRelay(false);
    }
  };

  const sendRelayIntervention = async () => {
    if (!liveRelay || !relayInterventionDraft.trim() || isSendingRelayIntervention) return;
    setIsSendingRelayIntervention(true);
    setRelayInterventionError(null);

    try {
      const response = editingRelayInterventionId
        ? await fetch(
            `/api/relays/${encodeURIComponent(liveRelay.id)}/interventions/${encodeURIComponent(editingRelayInterventionId)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: relayInterventionDraft.trim() }),
            }
          )
        : await fetch(`/api/relays/${encodeURIComponent(liveRelay.id)}/interventions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: relayInterventionDraft.trim() }),
          });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(
          data.error ??
            (editingRelayInterventionId
              ? 'Failed to update steer message.'
              : 'Failed to steer relay.')
        );
      }
      setRelayInterventionDraft('');
      setEditingRelayInterventionId(null);
    } catch (reason) {
      setRelayInterventionError(
        reason instanceof Error
          ? reason.message
          : editingRelayInterventionId
            ? 'Failed to update steer message.'
            : 'Failed to steer relay.'
      );
    } finally {
      setIsSendingRelayIntervention(false);
    }
  };

  const startEditingRelayIntervention = (intervention: AgentRelayInterventionDTO) => {
    setEditingRelayInterventionId(intervention.id);
    setRelayInterventionError(null);
    setRelayInterventionDraft(intervention.content);
  };

  const cancelEditingRelayIntervention = () => {
    setEditingRelayInterventionId(null);
    setRelayInterventionError(null);
    setRelayInterventionDraft('');
  };

  const removeRelayIntervention = async (interventionId: string) => {
    if (!liveRelay || isRemovingRelayIntervention) return;
    setIsRemovingRelayIntervention(interventionId);
    setRelayInterventionError(null);

    try {
      const response = await fetch(
        `/api/relays/${encodeURIComponent(liveRelay.id)}/interventions/${encodeURIComponent(interventionId)}`,
        { method: 'DELETE' }
      );
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to withdraw steer message.');
      }
      if (editingRelayInterventionId === interventionId) {
        cancelEditingRelayIntervention();
      }
    } catch (reason) {
      setRelayInterventionError(
        reason instanceof Error ? reason.message : 'Failed to withdraw steer message.'
      );
    } finally {
      setIsRemovingRelayIntervention(null);
    }
  };

  const pauseLiveRelay = async () => {
    if (!liveRelay || isUpdatingRelayLifecycle) return;
    setIsUpdatingRelayLifecycle(true);
    setRelayError(null);

    try {
      await pauseRelay(liveRelay.id);
    } catch (reason) {
      setRelayError(reason instanceof Error ? reason.message : 'Failed to pause relay.');
    } finally {
      setIsUpdatingRelayLifecycle(false);
    }
  };

  const resumeLiveRelay = async () => {
    if (!liveRelay || isUpdatingRelayLifecycle) return;
    setIsUpdatingRelayLifecycle(true);
    setRelayError(null);

    try {
      await resumeRelay(liveRelay.id);
    } catch (reason) {
      setRelayError(reason instanceof Error ? reason.message : 'Failed to resume relay.');
    } finally {
      setIsUpdatingRelayLifecycle(false);
    }
  };

  const resetDraft = () => {
    setPrompt('');
    setRelayPrompt('');
    setRelaySystemPrompt('');
    setRunError(null);
    setTerminalError(null);
    setChatError(null);
    setRelayError(null);
    setRelayInterventionError(null);
    setChatDraft('');
    setRelayInterventionDraft('');
    setEditingRelayInterventionId(null);
    setIsRemovingRelayIntervention(null);
    setProvider(activeSession?.provider ?? 'codex');
    setMode(activeSession ? 'resume' : 'task');
    setRelayStarter('codex');
    setRelayTemplateId('duel');
    setRelayMaxTurns(4);
    setCwd(activeSession?.projectPath ?? '');
    setSurface('run');
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="h-4 w-4 text-[var(--theme-accent-text)]" />
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
          <Badge className={streamBadgeClass(relayStatus)}>
            {isChinese ? 'relays' : 'relays'}{' '}
            {relayStatus === 'open' ? (isChinese ? '实时' : 'live') : isChinese ? '同步中' : 'syncing'}
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
                className="w-full rounded-xl bg-[var(--theme-accent-solid)] text-[var(--theme-accent-foreground)] hover:bg-[var(--theme-accent-solid-hover)]"
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
                className="w-full rounded-xl bg-[var(--theme-secondary-solid)] text-[var(--theme-secondary-foreground)] hover:bg-[var(--theme-secondary-solid-hover)]"
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
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Agent relay
              </div>
              <Badge variant="muted" className="bg-white/5 text-slate-300">
                {relays.length}
              </Badge>
            </div>

            <div className="mt-3 flex gap-2">
              {RELAY_TEMPLATE_IDS.map((templateId) => (
                <ModeChip
                  key={templateId}
                  active={relayTemplateId === templateId}
                  onClick={() => setRelayTemplateId(templateId)}
                  label={relayTemplateLabel(templateId, isChinese)}
                />
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <ModeChip
                active={relayStarter === 'codex'}
                onClick={() => setRelayStarter('codex')}
                label={isChinese ? 'Codex 先说' : 'Codex starts'}
              />
              <ModeChip
                active={relayStarter === 'claude'}
                onClick={() => setRelayStarter('claude')}
                label={isChinese ? 'Claude 先说' : 'Claude starts'}
              />
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                <Users className="h-3.5 w-3.5" />
                {isChinese ? '房间参与者' : 'Room participants'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {relayTemplate.participants.map((participant) => (
                  <Badge
                    key={`${participant.provider}-${participant.label}`}
                    className={
                      participant.provider === 'claude'
                        ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
                        : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                    }
                  >
                    {participant.label}
                  </Badge>
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-400">{relayTemplate.description}</div>
            </div>

            <label className="mt-3 block">
              <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                <span>{isChinese ? '对话轮数' : 'Turns'}</span>
                <span className="normal-case tracking-normal text-slate-400">{relayMaxTurns}</span>
              </div>
              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={relayMaxTurns}
                onChange={(event) => setRelayMaxTurns(Number(event.target.value))}
                className="w-full accent-[var(--theme-accent-solid)]"
              />
            </label>

            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'Relay 提示词' : 'Relay prompt'}
              </div>
              <textarea
                value={relayPrompt}
                onChange={(event) => setRelayPrompt(event.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                placeholder={
                  isChinese
                    ? '输入一个主题，让 Claude 和 Codex 围绕它轮流讨论、辩论或协作。'
                    : 'Give Claude and Codex a topic so they can alternate, debate, or collaborate.'
                }
              />
            </div>

            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'System prompt' : 'System prompt'}
              </div>
              <textarea
                value={relaySystemPrompt}
                onChange={(event) => setRelaySystemPrompt(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                placeholder={
                  isChinese
                    ? '给整个房间一条统一规则，比如先分析再决策，或重点关注风险与可执行性。'
                    : 'Give the whole room a shared rule, like analyze before deciding or focus on risks and actionability.'
                }
              />
            </div>

            {relayError ? <InlineNotice tone="error">{relayError}</InlineNotice> : null}

            <div className="mt-4">
              <Button
                onClick={() => void launchRelay()}
                disabled={!canLaunchRelay}
                className="w-full rounded-xl bg-[var(--theme-secondary-solid)] text-[var(--theme-secondary-foreground)] hover:bg-[var(--theme-secondary-solid-hover)]"
              >
                {isLaunchingRelay ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <SplitSquareVertical className="h-4 w-4" />
                )}
                {isChinese ? '启动 Agent Relay' : 'Start agent relay'}
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '活动历史' : 'Activity history'}
              </div>
              <Badge variant="muted" className="bg-white/5 text-slate-300">
                {runs.length + terminals.length + relays.length}
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
              {relays.slice(0, 4).map((entry) => (
                <PickerRow
                  key={entry.id}
                  active={entry.id === selectedRelayId && surface === 'relay'}
                  label={`${entry.participants.length}-agent room`}
                  sublabel={entry.title}
                  badge={entry.status}
                  badgeClass={relayBadgeClass(entry.status)}
                  onClick={() => {
                    setSurface('relay');
                    setSelectedRelayId(entry.id);
                  }}
                />
              ))}
              {runs.length === 0 && terminals.length === 0 && relays.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-5 text-sm text-slate-400">
                  {isChinese
                    ? '还没有活动记录，先启动一个 run 或 terminal 吧。'
                    : 'No activity yet. Launch a run, terminal, or relay to begin.'}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <BrowserChatCard
            chatDraft={chatDraft}
            canSend={canSendChat}
            chatError={chatError}
            cwd={cwd}
            isSending={isSendingChat}
            mode={mode}
            canResume={canResume}
            recentPrompts={recentChatPrompts}
            terminal={liveTerminal}
            onDraftChange={setChatDraft}
            onPickRecentPrompt={setChatDraft}
            onSend={() => void sendChatMessage()}
          />

          <div className="flex gap-2">
            <SurfaceChip
              active={surface === 'run'}
              onClick={() => setSurface('run')}
              icon={Play}
              label={isChinese ? '无头运行' : 'Headless run'}
            />
            <SurfaceChip
              active={surface === 'terminal'}
              onClick={() => setSurface('terminal')}
              icon={Monitor}
              label={isChinese ? '交互式终端' : 'Interactive terminal'}
            />
            <SurfaceChip
              active={surface === 'relay'}
              onClick={() => setSurface('relay')}
              icon={SplitSquareVertical}
              label="Agent relay"
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
          ) : surface === 'terminal' ? (
            <InteractiveTerminalPane
              terminal={liveTerminal}
              terminals={terminals}
              outputs={outputs}
              selectedTerminalId={selectedTerminalId}
              onPick={setSelectedTerminalId}
              onStop={stopTerminal}
            />
          ) : (
            <AgentRelayRoomPane
              relay={liveRelay}
              relays={relays}
              turns={turns}
              interventions={interventions}
              editingInterventionId={editingRelayInterventionId}
              interventionDraft={relayInterventionDraft}
              interventionError={relayInterventionError}
              isSendingIntervention={isSendingRelayIntervention}
              isUpdatingLifecycle={isUpdatingRelayLifecycle}
              removingInterventionId={isRemovingRelayIntervention}
              onInterventionDraftChange={setRelayInterventionDraft}
              onCancelInterventionEdit={cancelEditingRelayIntervention}
              onEditIntervention={startEditingRelayIntervention}
              onRemoveIntervention={(id) => void removeRelayIntervention(id)}
              onSendIntervention={() => void sendRelayIntervention()}
              onPick={setSelectedRelayId}
              onPause={() => void pauseLiveRelay()}
              onResume={() => void resumeLiveRelay()}
              onStop={stopRelay}
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

      {relay ? (
        <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '房间摘要' : 'Room summary'}
              </div>
              <div className="flex items-center gap-2">
                {relay.summary ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                    onClick={async () => {
                      await navigator.clipboard.writeText(relay.summary ?? '');
                      setCopiedSummary(true);
                      setTimeout(() => setCopiedSummary(false), 1500);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedSummary
                      ? isChinese
                        ? '已复制'
                        : 'Copied'
                      : isChinese
                        ? '复制'
                        : 'Copy'}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => downloadRelayMarkdown(relay, turns)}
                >
                  <Download className="h-4 w-4" />
                  {isChinese ? '导出' : 'Export'}
                </Button>
              </div>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
              {relay.summary ??
                (isChinese
                  ? '对话推进到足够轮次后会自动整理摘要。'
                  : 'A summary will appear automatically once the room has enough turns.')}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {isChinese ? '参与者' : 'Participants'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {relay.participants.map((participant) => (
                <Badge
                  key={participant.id}
                  className={
                    participant.provider === 'claude'
                      ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
                      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                  }
                >
                  {participant.label}
                </Badge>
              ))}
            </div>
            {relay.systemPrompt ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? 'System prompt' : 'System prompt'}
                </div>
                <div className="mt-2 whitespace-pre-wrap">{relay.systemPrompt}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {relay ? (
        <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '房间摘要' : 'Room summary'}
              </div>
              <div className="flex items-center gap-2">
                {relay.summary ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                    onClick={async () => {
                      await navigator.clipboard.writeText(relay.summary ?? '');
                      setCopiedSummary(true);
                      setTimeout(() => setCopiedSummary(false), 1500);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedSummary
                      ? isChinese
                        ? '已复制'
                        : 'Copied'
                      : isChinese
                        ? '复制'
                        : 'Copy'}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => downloadRelayMarkdown(relay, turns, interventions)}
                >
                  <Download className="h-4 w-4" />
                  {isChinese ? '导出' : 'Export'}
                </Button>
              </div>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
              {relay.summary ??
                (isChinese
                  ? '对话推进到足够轮次后会自动整理摘要。'
                  : 'A summary will appear automatically once the room has enough turns.')}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {isChinese ? '参与者' : 'Participants'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {relay.participants.map((participant) => (
                <Badge
                  key={participant.id}
                  className={
                    participant.provider === 'claude'
                      ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
                      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                  }
                >
                  {participant.label}
                </Badge>
              ))}
            </div>
            {relay.systemPrompt ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? 'System prompt' : 'System prompt'}
                </div>
                <div className="mt-2 whitespace-pre-wrap">{relay.systemPrompt}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {isChinese ? '介入房间' : 'Steer the room'}
          </div>
          <Badge variant="muted" className="bg-white/5 text-slate-300">
            {interventions.length}
          </Badge>
        </div>
        <textarea
          value={interventionDraft}
          onChange={(event) => onInterventionDraftChange(event.target.value)}
          rows={3}
          disabled={!relay || relay.status !== 'running' || isSendingIntervention}
          className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          placeholder={
            isChinese
              ? '插一句人工指令，比如“先统一结论，再给出行动计划”。'
              : 'Inject a human note, like “align on one conclusion, then give an action plan.”'
          }
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {relay?.status === 'running'
              ? isChinese
                ? '这条消息会从下一轮开始进入房间上下文。'
                : 'This note will join the room context starting from the next turn.'
              : isChinese
                ? '只有运行中的 relay 才能继续人工介入。'
                : 'Only a running relay can accept new human steering.'}
          </div>
          <Button
            onClick={onSendIntervention}
            disabled={!relay || relay.status !== 'running' || !interventionDraft.trim() || isSendingIntervention}
            className="rounded-xl bg-[var(--theme-accent-solid)] text-[var(--theme-accent-foreground)] hover:bg-[var(--theme-accent-solid-hover)]"
          >
            {isSendingIntervention ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
            {editingInterventionId
              ? isChinese
                ? '保存修改'
                : 'Save edit'
              : isChinese
                ? '发送给房间'
                : 'Send to room'}
          </Button>
        </div>
        {interventionError ? <InlineNotice tone="error">{interventionError}</InlineNotice> : null}
        {interventions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {interventions.slice(-3).reverse().map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-50"
              >
                <div className="text-[11px] uppercase tracking-[0.18em] text-amber-200/80">
                  {isChinese ? '最近人工消息' : 'Recent human steer'}
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words">{entry.content}</div>
              </div>
            ))}
          </div>
        ) : null}
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

function AgentRelayPane({
  relay,
  relays,
  turns,
  interventions,
  editingInterventionId,
  interventionDraft,
  interventionError,
  isSendingIntervention,
  removingInterventionId,
  onInterventionDraftChange,
  onCancelInterventionEdit,
  onEditIntervention,
  onRemoveIntervention,
  onSendIntervention,
  onPick,
  onStop,
}: {
  relay: AgentRelaySessionDTO | null;
  relays: AgentRelaySessionDTO[];
  turns: AgentRelayTurnDTO[];
  interventions: AgentRelayInterventionDTO[];
  editingInterventionId: string | null;
  interventionDraft: string;
  interventionError: string | null;
  isSendingIntervention: boolean;
  removingInterventionId: string | null;
  onInterventionDraftChange: (value: string) => void;
  onCancelInterventionEdit: () => void;
  onEditIntervention: (intervention: AgentRelayInterventionDTO) => void;
  onRemoveIntervention: (interventionId: string) => void;
  onSendIntervention: () => void;
  onPick: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const { isChinese, language } = useI18n();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [interventions, turns]);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {isChinese ? 'Agent Relay' : 'Agent Relay'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {relay
              ? `${relay.starter} starts · ${relay.currentTurn}/${relay.maxTurns} turns · ${relay.status}`
              : isChinese
                ? '选择一个 relay 会话'
                : 'Select an agent relay'}
          </div>
        </div>
        {relay && (relay.status === 'starting' || relay.status === 'running') ? (
          <Button
            variant="outline"
            size="sm"
            className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
            onClick={() => void onStop(relay.id)}
          >
            <Square className="h-4 w-4" />
            {isChinese ? '停止 relay' : 'Stop relay'}
          </Button>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className="h-[320px] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-3"
      >
        {turns.length === 0 ? (
          <div className="text-sm text-slate-500">
            {isChinese
              ? '启动一个 Agent Relay 后，这里会显示 Claude 和 Codex 的轮流对话。'
              : 'Launch an agent relay to see Claude and Codex take turns here.'}
          </div>
        ) : (
          <div className="space-y-3">
            {turns.map((turn) => (
              <article
                key={turn.id}
                className={cn(
                  'rounded-2xl border p-3',
                  turn.agent === 'claude'
                    ? 'border-sky-400/20 bg-sky-400/[0.06]'
                    : 'border-emerald-400/20 bg-emerald-400/[0.06]'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    <Badge className={turn.agent === 'claude' ? 'border-sky-400/30 bg-sky-400/10 text-sky-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}>
                      {turn.participantLabel}
                    </Badge>
                    <span>{isChinese ? `第 ${turn.turn} 轮` : `Turn ${turn.turn}`}</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {new Intl.DateTimeFormat(language, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }).format(turn.startedAtMs)}
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {isChinese ? '输出' : 'Output'}
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">
                    {turn.output || (turn.status === 'running'
                      ? isChinese
                        ? '等待当前 agent 回复中...'
                        : 'Waiting for the current agent response...'
                      : isChinese
                        ? '该轮没有输出。'
                        : 'No output for this turn.')}
                  </pre>
                </div>
                {turn.error ? (
                  <div className="mt-2 text-sm text-rose-200">{turn.error}</div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {relays.slice(0, 5).map((entry) => (
          <PickerRow
            key={entry.id}
            active={entry.id === relay?.id}
            label={`${entry.participants.length}-agent room`}
            sublabel={entry.title}
            badge={entry.status}
            badgeClass={relayBadgeClass(entry.status)}
            onClick={() => onPick(entry.id)}
          />
        ))}
      </div>
    </section>
  );
}

function AgentRelayRoomPane({
  relay,
  relays,
  turns,
  interventions,
  editingInterventionId,
  interventionDraft,
  interventionError,
  isSendingIntervention,
  isUpdatingLifecycle,
  removingInterventionId,
  onInterventionDraftChange,
  onCancelInterventionEdit,
  onEditIntervention,
  onRemoveIntervention,
  onSendIntervention,
  onPick,
  onPause,
  onResume,
  onStop,
}: {
  relay: AgentRelaySessionDTO | null;
  relays: AgentRelaySessionDTO[];
  turns: AgentRelayTurnDTO[];
  interventions: AgentRelayInterventionDTO[];
  editingInterventionId: string | null;
  interventionDraft: string;
  interventionError: string | null;
  isSendingIntervention: boolean;
  isUpdatingLifecycle: boolean;
  removingInterventionId: string | null;
  onInterventionDraftChange: (value: string) => void;
  onCancelInterventionEdit: () => void;
  onEditIntervention: (intervention: AgentRelayInterventionDTO) => void;
  onRemoveIntervention: (interventionId: string) => void;
  onSendIntervention: () => void;
  onPick: (id: string) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: (id: string) => Promise<void>;
}) {
  const { isChinese, language } = useI18n();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const timeline = useMemo(
    () => buildRelayTimeline(turns, interventions),
    [interventions, turns]
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [timeline]);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Agent Relay</div>
          <div className="mt-1 text-sm text-slate-300">
            {relay
              ? `${relay.starter} starts · ${relay.currentTurn}/${relay.maxTurns} turns · ${relay.status}`
              : isChinese
                ? '选择一个 relay 会话'
                : 'Select an agent relay'}
          </div>
        </div>
        {relay ? (
          <div className="flex items-center gap-2">
            {(relay.status === 'starting' || relay.status === 'running') && (
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdatingLifecycle}
                className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                onClick={onPause}
              >
                {isUpdatingLifecycle ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Pause className="h-4 w-4" />
                )}
                {isChinese ? '暂停' : 'Pause'}
              </Button>
            )}
            {relay.status === 'paused' && (
              <Button
                variant="outline"
                size="sm"
                disabled={isUpdatingLifecycle}
                className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                onClick={onResume}
              >
                {isUpdatingLifecycle ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {isChinese ? '继续' : 'Resume'}
              </Button>
            )}
            {(relay.status === 'starting' ||
              relay.status === 'running' ||
              relay.status === 'paused') && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                onClick={() => void onStop(relay.id)}
              >
                <Square className="h-4 w-4" />
                {isChinese ? '停止 relay' : 'Stop relay'}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {relay ? (
        <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '房间摘要' : 'Room summary'}
              </div>
              <div className="flex items-center gap-2">
                {relay.summary ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                    onClick={async () => {
                      await navigator.clipboard.writeText(relay.summary ?? '');
                      setCopiedSummary(true);
                      setTimeout(() => setCopiedSummary(false), 1500);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    {copiedSummary
                      ? isChinese
                        ? '已复制'
                        : 'Copied'
                      : isChinese
                        ? '复制'
                        : 'Copy'}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => downloadRelayMarkdown(relay, turns, interventions)}
                >
                  <Download className="h-4 w-4" />
                  {isChinese ? '导出' : 'Export'}
                </Button>
              </div>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
              {relay.summary ??
                (isChinese
                  ? '对话推进到足够轮次后会自动整理摘要。'
                  : 'A summary will appear automatically once the room has enough turns.')}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
              {isChinese ? '参与者' : 'Participants'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {relay.participants.map((participant) => (
                <Badge
                  key={participant.id}
                  className={
                    participant.provider === 'claude'
                      ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
                      : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                  }
                >
                  {participant.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={viewportRef}
        className="h-[320px] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-3"
      >
        {timeline.length === 0 ? (
          <div className="text-sm text-slate-500">
            {isChinese
              ? '启动一个 Agent Relay 后，这里会显示智能体回合和人工插话的完整时间线。'
              : 'Launch an agent relay to see the full room timeline, including agent turns and human steer messages.'}
          </div>
        ) : (
          <div className="space-y-3">
            {timeline.map((entry) =>
              entry.type === 'intervention' ? (
                <article
                  key={entry.id}
                  className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-100">
                        {isChinese ? '人工' : 'Human'}
                      </Badge>
                      <span>{isChinese ? '房间插话' : 'Room steer'}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatRelayTime(entry.createdAtMs, language)}
                    </div>
                  </div>
                  <div className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-amber-400/15 bg-black/20 p-3 text-sm leading-6 text-amber-50">
                    {entry.content}
                  </div>
                  {entry.updatedAtMs ? (
                    <div className="mt-2 text-[11px] text-amber-200/80">
                      {isChinese ? '已编辑' : 'Edited'}
                    </div>
                  ) : null}
                </article>
              ) : (
                <article
                  key={entry.id}
                  className={cn(
                    'rounded-2xl border p-3',
                    entry.agent === 'claude'
                      ? 'border-sky-400/20 bg-sky-400/[0.06]'
                      : 'border-emerald-400/20 bg-emerald-400/[0.06]'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <Badge
                        className={
                          entry.agent === 'claude'
                            ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
                            : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                        }
                      >
                        {entry.participantLabel}
                      </Badge>
                      <span>{isChinese ? `第 ${entry.turn} 轮` : `Turn ${entry.turn}`}</span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatRelayTime(entry.createdAtMs, language)}
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                      {isChinese ? '输出' : 'Output'}
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">
                      {entry.output ||
                        (entry.status === 'running'
                          ? isChinese
                            ? '等待当前 agent 回复中...'
                            : 'Waiting for the current agent response...'
                          : isChinese
                            ? '这一轮没有输出。'
                            : 'No output for this turn.')}
                    </pre>
                  </div>
                  {entry.error ? (
                    <div className="mt-2 text-sm text-rose-200">{entry.error}</div>
                  ) : null}
                </article>
              )
            )}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            <MessageSquare className="h-3.5 w-3.5" />
            {isChinese ? '介入房间' : 'Steer the room'}
          </div>
          <Badge variant="muted" className="bg-white/5 text-slate-300">
            {interventions.length}
          </Badge>
        </div>
        {editingInterventionId ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-sm text-amber-50">
            <span>
              {isChinese
                ? '正在编辑一条人工消息，保存后会继续影响后续回合。'
                : 'Editing a steer message. Saving it will affect the next turns.'}
            </span>
            <button
              type="button"
              onClick={onCancelInterventionEdit}
              className="rounded-full border border-amber-300/20 px-2.5 py-1 text-xs text-amber-100 transition hover:bg-amber-300/10"
            >
              {isChinese ? '取消编辑' : 'Cancel edit'}
            </button>
          </div>
        ) : null}
        <textarea
          value={interventionDraft}
          onChange={(event) => onInterventionDraftChange(event.target.value)}
          rows={3}
          disabled={
            !relay ||
            (relay.status !== 'running' && relay.status !== 'paused') ||
            isSendingIntervention
          }
          className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          placeholder={
            isChinese
              ? '插一句人工指令，比如“先统一结论，再给出行动计划”。'
              : 'Inject a human note, like “align on one conclusion, then give an action plan.”'
          }
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {relay?.status === 'paused'
              ? isChinese
                ? '房间暂停时也可以先留下人工指令，恢复后会继续沿用。'
                : 'You can add a steer message while paused, and it will be used after resume.'
              : relay?.status === 'running'
                ? isChinese
                  ? '这条消息会从下一轮开始进入房间上下文。'
                  : 'This message will enter the room context starting with the next turn.'
                : isChinese
                  ? '房间运行中或暂停时可以发送人工消息。'
                  : 'Human messages can be sent while the room is running or paused.'}
          </div>
          <Button
            onClick={onSendIntervention}
            disabled={
              !relay ||
              (relay.status !== 'running' && relay.status !== 'paused') ||
              !interventionDraft.trim() ||
              isSendingIntervention
            }
            className="rounded-xl bg-[var(--theme-accent-solid)] text-[var(--theme-accent-foreground)] hover:bg-[var(--theme-accent-solid-hover)]"
          >
            {isSendingIntervention ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
            {editingInterventionId
              ? isChinese
                ? '保存修改'
                : 'Save edit'
              : isChinese
                ? '发送给房间'
                : 'Send to room'}
          </Button>
        </div>
        {interventionError ? <InlineNotice tone="error">{interventionError}</InlineNotice> : null}
        {interventions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {interventions
              .slice()
              .reverse()
              .slice(0, 4)
              .map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-amber-200/80">
                      {isChinese ? '最近人工消息' : 'Recent human steer'}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditIntervention(entry)}
                        disabled={isSendingIntervention || removingInterventionId === entry.id}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil className="h-3 w-3" />
                        {isChinese ? '编辑' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveIntervention(entry.id)}
                        disabled={isSendingIntervention || removingInterventionId === entry.id}
                        className="inline-flex items-center gap-1 rounded-full border border-rose-300/20 px-2 py-1 text-[11px] text-rose-100 transition hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {removingInterventionId === entry.id ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                        {isChinese ? '撤回' : 'Withdraw'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-sm text-amber-50">
                    {entry.content}
                  </div>
                  {entry.updatedAtMs ? (
                    <div className="mt-1 text-[11px] text-amber-200/80">
                      {isChinese ? '已编辑' : 'Edited'}
                    </div>
                  ) : null}
                </div>
              ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {relays.slice(0, 5).map((entry) => (
          <PickerRow
            key={entry.id}
            active={entry.id === relay?.id}
            label={`${entry.participants.length}-agent room`}
            sublabel={entry.title}
            badge={entry.status}
            badgeClass={relayBadgeClass(entry.status)}
            onClick={() => onPick(entry.id)}
          />
        ))}
      </div>
    </section>
  );
}

function BrowserChatCard({
  chatDraft,
  canResume,
  canSend,
  chatError,
  cwd,
  isSending,
  mode,
  recentPrompts,
  terminal,
  onDraftChange,
  onPickRecentPrompt,
  onSend,
}: {
  chatDraft: string;
  canResume: boolean;
  canSend: boolean;
  chatError: string | null;
  cwd: string;
  isSending: boolean;
  mode: 'task' | 'resume';
  recentPrompts: string[];
  terminal: TerminalSessionDTO | null;
  onDraftChange: (value: string) => void;
  onPickRecentPrompt: (value: string) => void;
  onSend: () => void;
}) {
  const { isChinese } = useI18n();
  const terminalReady = terminal?.status === 'open';
  const hasRecentPrompts = recentPrompts.length > 0;
  const disabledReason =
    cwd.trim().length === 0
      ? isChinese
        ? '先填写工作区路径后再发送消息。'
        : 'Add a workspace path before sending a message.'
      : mode === 'resume' && !canResume
        ? isChinese
          ? '恢复模式需要先选中同 provider 的会话。'
          : 'Resume mode requires an active session from the same provider.'
        : null;
  const statusText = isSending
    ? isChinese
      ? '正在把消息发送给 agent...'
      : 'Sending your message to the agent...'
    : terminalReady
      ? isChinese
        ? `当前已连接到 ${terminal.provider} terminal`
        : `Connected to the ${terminal.provider} terminal`
      : isChinese
        ? '首条消息会自动启动 terminal 并开始对话'
        : 'Your first message will auto-start a terminal and begin the conversation';

  return (
    <section className="flex min-h-[420px] flex-col rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            <MessageSquare className="h-3.5 w-3.5" />
            {isChinese ? '浏览器对话' : 'Browser chat'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {terminalReady
              ? isChinese
                ? '直接把消息发给当前打开的 agent terminal。'
                : 'Send messages straight into the open agent terminal.'
              : isChinese
                ? '输入后会自动拉起一个 terminal，并把这条消息发送给 agent。'
                : 'The first message will auto-open a terminal and send itself to the agent.'}
          </div>
        </div>
        <Badge
          className={
            terminalReady
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
              : 'border-white/10 bg-white/[0.04] text-slate-300'
          }
        >
          {terminalReady
            ? isChinese
              ? '已连接'
              : 'connected'
            : isChinese
              ? '自动启动'
              : 'auto-start'}
        </Badge>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-slate-300">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              isSending
                ? 'animate-pulse bg-[var(--theme-accent-foreground)] shadow-[0_0_16px_rgba(255,255,255,0.45)]'
                : terminalReady
                  ? 'bg-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.45)]'
                  : 'bg-slate-500'
            )}
          />
          <span className="truncate">{statusText}</span>
        </div>
        <div className="shrink-0 text-[11px] text-slate-500">
          {isChinese ? '右侧终端实时回流' : 'Streams into the terminal pane'}
        </div>
      </div>

      <div className="mt-3 flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            <Command className="h-3.5 w-3.5" />
            {isChinese ? '历史快捷提问' : 'Recent prompts'}
          </div>
          <Badge variant="muted" className="bg-white/5 text-slate-300">
            {recentPrompts.length}
          </Badge>
        </div>

        {hasRecentPrompts ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {recentPrompts.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => onPickRecentPrompt(entry)}
                className="max-w-full rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-[var(--theme-accent-border)] hover:bg-[var(--theme-accent-soft)] hover:text-white"
                title={entry}
              >
                <span className="block max-w-[260px] truncate">{entry}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-4 text-sm text-slate-400">
            {isChinese
              ? '这里会记住你最近发给 agent 的问题，点击就能重新带回输入框。'
              : 'Your latest prompts will show up here so you can reuse them with one click.'}
          </div>
        )}

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              <Keyboard className="h-3.5 w-3.5" />
              {isChinese ? '发送快捷键' : 'Shortcut'}
            </div>
            <div className="mt-2 text-sm text-slate-300">
              {isChinese ? '`Ctrl/Cmd + Enter` 发送，`Enter` 换行。' : '`Ctrl/Cmd + Enter` sends, `Enter` adds a new line.'}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              <CornerDownLeft className="h-3.5 w-3.5" />
              {isChinese ? '发送方式' : 'Delivery'}
            </div>
            <div className="mt-2 text-sm text-slate-300">
              {isChinese
                ? '优先复用当前 terminal；没有打开会话时自动新建并发出首条消息。'
                : 'Reuses the current terminal when available, otherwise opens one and delivers the first message automatically.'}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 shrink-0 rounded-[24px] border border-[var(--theme-accent-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {isChinese ? '消息输入' : 'Message composer'}
          </div>
          <div className="text-xs text-slate-400">
            {isChinese ? '底部固定输入栏' : 'Docked composer'}
          </div>
        </div>
        <textarea
          value={chatDraft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
            event.preventDefault();
            onSend();
          }}
          rows={4}
          disabled={isSending}
          className="w-full resize-none bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-wait disabled:opacity-70"
          placeholder={
            isChinese
              ? '直接输入你想让 agent 做的事，Ctrl/Cmd + Enter 发送，Enter 换行。'
              : 'Type what you want the agent to do. Press Ctrl/Cmd+Enter to send, Enter for a new line.'
          }
        />
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <div className="min-w-0 text-xs text-slate-400">
            {disabledReason ??
              (isSending
                ? isChinese
                  ? '正在等待 agent 接收这条消息，输出会继续在终端面板滚动。'
                  : 'Waiting for the agent to receive your message. Output will keep streaming in the terminal pane.'
                : terminalReady
                  ? isChinese
                    ? `已连接到 ${terminal.provider} terminal，可继续对话`
                    : `Connected to the ${terminal.provider} terminal and ready for the next turn`
                  : isChinese
                    ? '发送后会在右侧终端面板显示实时输出'
                    : 'Output will stream into the terminal pane on the right')}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-400 md:block">
              {isChinese ? 'Ctrl/Cmd + Enter' : 'Ctrl/Cmd + Enter'}
            </div>
            <Button
              onClick={onSend}
              disabled={!canSend}
              className="rounded-xl bg-[var(--theme-accent-solid)] text-[var(--theme-accent-foreground)] hover:bg-[var(--theme-accent-solid-hover)]"
            >
              {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              {isSending
                ? isChinese
                  ? '发送中...'
                  : 'Sending...'
                : terminalReady
                  ? isChinese
                    ? '发送'
                    : 'Send'
                  : isChinese
                    ? '启动并发送'
                    : 'Start and send'}
            </Button>
          </div>
        </div>
      </div>

      {chatError ? <InlineNotice tone="error">{chatError}</InlineNotice> : null}
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
          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)]'
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
          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
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
          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
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

async function stopRelay(relayId: string) {
  await fetch(`/api/relays/${encodeURIComponent(relayId)}/stop`, { method: 'POST' });
}

async function pauseRelay(relayId: string) {
  const response = await fetch(`/api/relays/${encodeURIComponent(relayId)}/pause`, {
    method: 'POST',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'Failed to pause relay.');
  }
}

async function resumeRelay(relayId: string) {
  const response = await fetch(`/api/relays/${encodeURIComponent(relayId)}/resume`, {
    method: 'POST',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'Failed to resume relay.');
  }
}

async function sendTerminalInput(terminalId: string, input: string) {
  if (!input) return;
  await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
}

function normalizeChatInput(value: string) {
  return `${value.replace(/\r?\n/g, '\r')}\r`;
}

function relayTemplateLabel(templateId: RelayTemplateId, isChinese: boolean) {
  if (templateId === 'review-trio') {
    return isChinese ? '评审三人组' : 'Review trio';
  }
  if (templateId === 'delivery-room') {
    return isChinese ? '交付房间' : 'Delivery room';
  }
  return isChinese ? '经典对谈' : 'Classic duel';
}

function buildRelayTemplate(
  templateId: RelayTemplateId,
  starter: SessionDTO['provider'],
  isChinese: boolean
): {
  participants: AgentRelayParticipantInputDTO[];
  description: string;
} {
  if (templateId === 'review-trio') {
    return {
      participants: [
        {
          provider: 'claude',
          label: isChinese ? 'Claude 架构师' : 'Claude architect',
        },
        {
          provider: 'codex',
          label: isChinese ? 'Codex 实现者' : 'Codex implementer',
        },
        {
          provider: 'claude',
          label: isChinese ? 'Claude 审查者' : 'Claude reviewer',
        },
      ],
      description: isChinese
        ? '适合先拆问题、再落实现、最后做质量回看。'
        : 'Good for breaking down work, shipping changes, then reviewing quality.',
    };
  }

  if (templateId === 'delivery-room') {
    return {
      participants: [
        {
          provider: 'codex',
          label: isChinese ? 'Codex 构建者' : 'Codex builder',
        },
        {
          provider: 'claude',
          label: isChinese ? 'Claude 产品经理' : 'Claude product lead',
        },
        {
          provider: 'codex',
          label: isChinese ? 'Codex 修复者' : 'Codex fixer',
        },
        {
          provider: 'claude',
          label: isChinese ? 'Claude 发布官' : 'Claude ship captain',
        },
      ],
      description: isChinese
        ? '更像一个交付房间，强调推进、修补和最终拍板。'
        : 'Feels like a shipping room with momentum, fixes, and a final ship decision.',
    };
  }

  const second = starter === 'claude' ? 'codex' : 'claude';
  return {
    participants: [
      {
        provider: starter,
        label:
          starter === 'claude'
            ? isChinese
              ? 'Claude 主讲'
              : 'Claude lead'
            : isChinese
              ? 'Codex 主讲'
              : 'Codex lead',
      },
      {
        provider: second,
        label:
          second === 'claude'
            ? isChinese
              ? 'Claude 评审'
              : 'Claude reviewer'
            : isChinese
              ? 'Codex 评审'
              : 'Codex reviewer',
      },
    ],
    description: isChinese
      ? '最接近原始 relay 的双人回合制，对话清晰、节奏快。'
      : 'Closest to the original relay: a clear, fast two-agent back-and-forth.',
  };
}

function downloadRelayMarkdown(
  relay: AgentRelaySessionDTO,
  turns: AgentRelayTurnDTO[],
  interventions: AgentRelayInterventionDTO[]
) {
  if (typeof window === 'undefined') return;
  const markdown = buildRelayMarkdown(relay, turns, interventions);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugify(relay.title || 'agent-relay')}.md`;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function buildRelayMarkdown(
  relay: AgentRelaySessionDTO,
  turns: AgentRelayTurnDTO[],
  interventions: AgentRelayInterventionDTO[]
) {
  const timeline = buildRelayTimeline(turns, interventions);
  const lines: Array<string | null> = [
    `# ${relay.title}`,
    '',
    `- Status: ${relay.status}`,
    `- Workspace: ${relay.cwd}`,
    `- Turns: ${relay.currentTurn}/${relay.maxTurns}`,
    `- Participants: ${relay.participants.map((entry) => `${entry.label} (${entry.provider})`).join(', ')}`,
    '',
    '## Goal',
    '',
    relay.initialPrompt,
    '',
  ];

  if (relay.systemPrompt) {
    lines.push('## System Prompt', '', relay.systemPrompt, '');
  }

  if (relay.summary) {
    lines.push('## Summary', '', relay.summary, '');
  }

  lines.push('## Transcript', '');
  for (const entry of timeline) {
    if (entry.type === 'intervention') {
      lines.push(
        `### Human steer · ${new Date(entry.createdAtMs).toLocaleString()}`,
        '',
        entry.content,
        ''
      );
      continue;
    }

    lines.push(
      `### Turn ${entry.turn} · ${entry.participantLabel}`,
      '',
      `- Provider: ${entry.agent}`,
      `- Status: ${entry.status}`,
      `- Started: ${new Date(entry.startedAtMs).toLocaleString()}`,
      entry.endedAtMs ? `- Ended: ${new Date(entry.endedAtMs).toLocaleString()}` : null,
      '',
      '#### Prompt',
      '',
      entry.prompt || '_No prompt_',
      '',
      '#### Output',
      '',
      entry.output || '_No output_',
      ''
    );
    if (entry.error) {
      lines.push('#### Error', '', entry.error, '');
    }
  }

  return lines.filter((line): line is string => line !== null).join('\n');
}

type RelayTimelineEntry =
  | (AgentRelayTurnDTO & { type: 'turn'; createdAtMs: number })
  | (AgentRelayInterventionDTO & { type: 'intervention' });

function buildRelayTimeline(
  turns: AgentRelayTurnDTO[],
  interventions: AgentRelayInterventionDTO[]
): RelayTimelineEntry[] {
  const entries: RelayTimelineEntry[] = [
    ...turns.map((turn) => ({
      ...turn,
      type: 'turn' as const,
      createdAtMs: turn.endedAtMs ?? turn.startedAtMs,
    })),
    ...interventions.map((intervention) => ({
      ...intervention,
      type: 'intervention' as const,
    })),
  ];

  return entries.sort((left, right) => left.createdAtMs - right.createdAtMs);
}

function formatRelayTime(createdAtMs: number, language: string) {
  return new Intl.DateTimeFormat(language, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(createdAtMs);
}

function slugify(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'agent-relay';
}

function readRecentChatPrompts(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_RECENT_CHAT_PROMPTS);
  } catch {
    return [];
  }
}

function writeRecentChatPrompts(prompts: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_CHAT_STORAGE_KEY, JSON.stringify(prompts));
  } catch {
    // Ignore storage failures so the chat composer still works.
  }
}

function rememberRecentChatPrompt(existing: string[], nextPrompt: string) {
  const normalizedPrompt = nextPrompt.trim();
  if (!normalizedPrompt) return existing;
  return [normalizedPrompt, ...existing.filter((entry) => entry !== normalizedPrompt)].slice(
    0,
    MAX_RECENT_CHAT_PROMPTS
  );
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

function relayBadgeClass(status: AgentRelaySessionDTO['status']) {
  if (status === 'running' || status === 'starting') {
    return 'border-violet-400/30 bg-violet-400/10 text-violet-100';
  }
  if (status === 'paused') {
    return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  }
  if (status === 'completed') {
    return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  }
  if (status === 'stopped') {
    return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  }
  return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
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
      relayPrompt: typeof parsed.relayPrompt === 'string' ? parsed.relayPrompt : '',
      relaySystemPrompt:
        typeof parsed.relaySystemPrompt === 'string' ? parsed.relaySystemPrompt : '',
      relayStarter: parsed.relayStarter === 'claude' ? 'claude' : 'codex',
      relayTemplateId:
        typeof parsed.relayTemplateId === 'string' &&
        RELAY_TEMPLATE_IDS.includes(parsed.relayTemplateId as RelayTemplateId)
          ? (parsed.relayTemplateId as RelayTemplateId)
          : 'duel',
      relayMaxTurns:
        typeof parsed.relayMaxTurns === 'number' && Number.isFinite(parsed.relayMaxTurns)
          ? Math.min(12, Math.max(2, Math.round(parsed.relayMaxTurns)))
          : 4,
      selectedRunId: typeof parsed.selectedRunId === 'string' ? parsed.selectedRunId : null,
      selectedTerminalId:
        typeof parsed.selectedTerminalId === 'string' ? parsed.selectedTerminalId : null,
      selectedRelayId: typeof parsed.selectedRelayId === 'string' ? parsed.selectedRelayId : null,
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
  return value === 'run' || value === 'terminal' || value === 'relay';
}
