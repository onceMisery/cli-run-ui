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
  AgentTaskDTO,
  AgentTaskEventDTO,
  ImportedGitHubIssueDraftDTO,
  RunSessionDTO,
  SessionDTO,
  StartAgentTaskRequestDTO,
  StartAgentRelayRequestDTO,
  StartRunRequestDTO,
  StartTerminalRequestDTO,
  TerminalSessionDTO,
} from '@cli-run-ui/core';
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
import type { Terminal as XTermTerminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Command,
  CornerDownLeft,
  Download,
  GitBranch,
  GitPullRequestArrow,
  Keyboard,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Monitor,
  Pause,
  Pencil,
  Pin,
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
import { useTaskStream } from '@/hooks/useTaskStream';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { copyTextWithFeedback } from '@/lib/copy-feedback';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type LaunchSurface = 'task' | 'run' | 'terminal' | 'relay';

interface AgentWorkbenchPanelProps {
  activeSession: SessionDTO | null;
  runs: RunSessionDTO[];
  runStatus: StreamStatus;
  tasks: AgentTaskDTO[];
  taskStatus: StreamStatus;
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
  relayPinnedRulesDraft: string;
  relaySystemPrompt: string;
  relayStarter: SessionDTO['provider'];
  relayTemplateId: RelayTemplateId;
  relayMaxTurns: number;
  selectedTaskId: string | null;
  selectedRunId: string | null;
  selectedTerminalId: string | null;
  selectedRelayId: string | null;
}

type RelayTemplateId = string;

interface RelayTemplateDefinition {
  id: RelayTemplateId;
  name: string;
  participants: AgentRelayParticipantInputDTO[];
  description: string;
  defaultPinnedRules: string[];
  systemPrompt?: string;
  focus?: string;
  deliverable?: string;
  promptPlaceholder?: string;
  promptIdeas?: string[];
  starter?: SessionDTO['provider'];
  maxTurns?: number;
  custom?: boolean;
}

interface CustomRelayTemplateRecord {
  id: string;
  name: string;
  participants: AgentRelayParticipantInputDTO[];
  description: string;
  defaultPinnedRules: string[];
  systemPrompt?: string;
  starter: SessionDTO['provider'];
  maxTurns: number;
}

const WORKBENCH_STORAGE_KEY = 'cli-run-ui.agent-workbench';
const RECENT_CHAT_STORAGE_KEY = 'cli-run-ui.recent-chat-prompts';
const CUSTOM_RELAY_TEMPLATES_STORAGE_KEY = 'cli-run-ui.custom-relay-templates';
const MAX_RECENT_CHAT_PROMPTS = 6;
const BUILTIN_RELAY_TEMPLATE_IDS = ['duel', 'review-trio', 'delivery-room'] as const;
const RELAY_TEMPLATE_IDS: RelayTemplateId[] = [...BUILTIN_RELAY_TEMPLATE_IDS];
const REQUEST_TIMEOUT_MS = 12000;
const WORKBENCH_PANEL_CLASS = 'theme-panel rounded-[26px] p-4';
const WORKBENCH_PANEL_MUTED_CLASS = 'theme-panel-muted rounded-2xl p-3';
const WORKBENCH_PANEL_STRONG_CLASS = 'theme-panel-strong rounded-2xl p-3';
const WORKBENCH_INPUT_CLASS =
  'theme-input w-full rounded-xl px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500';

export function AgentWorkbenchPanel({
  activeSession,
  runs,
  runStatus,
  tasks,
  taskStatus,
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
  const [relayPinnedRulesDraft, setRelayPinnedRulesDraft] = useState(
    savedPreferences?.relayPinnedRulesDraft ?? ''
  );
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
  const [taskTitle, setTaskTitle] = useState('');
  const [taskIssueUrl, setTaskIssueUrl] = useState('');
  const [taskTestCommand, setTaskTestCommand] = useState('');
  const [taskError, setTaskError] = useState<string | null>(null);
  const [isLaunchingTask, setIsLaunchingTask] = useState(false);
  const [isImportingTaskIssue, setIsImportingTaskIssue] = useState(false);
  const [isRefreshingTask, setIsRefreshingTask] = useState(false);
  const [isCreatingTaskPr, setIsCreatingTaskPr] = useState(false);
  const [isReviewingTaskPr, setIsReviewingTaskPr] = useState(false);
  const [isMergingTaskPr, setIsMergingTaskPr] = useState(false);
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
  const [isMovingRelayIntervention, setIsMovingRelayIntervention] = useState<string | null>(null);
  const [isPinningRelayIntervention, setIsPinningRelayIntervention] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [relayInterventionDraft, setRelayInterventionDraft] = useState('');
  const [relayInterventionError, setRelayInterventionError] = useState<string | null>(null);
  const [recentChatPrompts, setRecentChatPrompts] = useState<string[]>(() =>
    readRecentChatPrompts()
  );
  const [customRelayTemplates, setCustomRelayTemplates] = useState<CustomRelayTemplateRecord[]>(() =>
    readCustomRelayTemplates()
  );
  const [customRelayTemplateName, setCustomRelayTemplateName] = useState('');
  const [editingCustomRelayTemplateId, setEditingCustomRelayTemplateId] = useState<string | null>(
    null
  );
  const [relayTemplateError, setRelayTemplateError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    savedPreferences?.selectedTaskId ?? tasks[0]?.id ?? null
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
  const pendingTaskSelectionRef = useRef<string | null>(null);
  const pendingRunSelectionRef = useRef<string | null>(null);
  const pendingTerminalSelectionRef = useRef<string | null>(null);
  const pendingRelaySelectionRef = useRef<string | null>(null);

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
      relayPinnedRulesDraft,
      relaySystemPrompt,
      relayStarter,
      relayTemplateId,
      relayMaxTurns,
      selectedTaskId,
      selectedRunId,
      selectedTerminalId,
      selectedRelayId,
    });
  }, [
    cwd,
    mode,
    prompt,
    relayPinnedRulesDraft,
    relaySystemPrompt,
    provider,
    relayMaxTurns,
    relayPrompt,
    relayStarter,
    relayTemplateId,
    selectedRelayId,
    selectedTaskId,
    selectedRunId,
    selectedTerminalId,
    surface,
  ]);

  useEffect(() => {
    if (tasks.length === 0) {
      if (selectedTaskId && pendingTaskSelectionRef.current === selectedTaskId) return;
      setSelectedTaskId(null);
      return;
    }
    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) {
      if (pendingTaskSelectionRef.current === selectedTaskId) {
        pendingTaskSelectionRef.current = null;
      }
      return;
    }
    if (selectedTaskId && pendingTaskSelectionRef.current === selectedTaskId) return;
    setSelectedTaskId(tasks[0]?.id ?? null);
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (runs.length === 0) {
      if (selectedRunId && pendingRunSelectionRef.current === selectedRunId) return;
      setSelectedRunId(null);
      return;
    }
    if (selectedRunId && runs.some((run) => run.id === selectedRunId)) {
      if (pendingRunSelectionRef.current === selectedRunId) {
        pendingRunSelectionRef.current = null;
      }
      return;
    }
    if (selectedRunId && pendingRunSelectionRef.current === selectedRunId) return;
    setSelectedRunId(runs[0]?.id ?? null);
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (terminals.length === 0) {
      if (selectedTerminalId && pendingTerminalSelectionRef.current === selectedTerminalId) {
        return;
      }
      setSelectedTerminalId(null);
      return;
    }
    if (selectedTerminalId && terminals.some((terminal) => terminal.id === selectedTerminalId)) {
      if (pendingTerminalSelectionRef.current === selectedTerminalId) {
        pendingTerminalSelectionRef.current = null;
      }
      return;
    }
    if (selectedTerminalId && pendingTerminalSelectionRef.current === selectedTerminalId) return;
    setSelectedTerminalId(terminals[0]?.id ?? null);
  }, [selectedTerminalId, terminals]);

  useEffect(() => {
    if (relays.length === 0) {
      if (selectedRelayId && pendingRelaySelectionRef.current === selectedRelayId) return;
      setSelectedRelayId(null);
      return;
    }
    if (selectedRelayId && relays.some((relay) => relay.id === selectedRelayId)) {
      if (pendingRelaySelectionRef.current === selectedRelayId) {
        pendingRelaySelectionRef.current = null;
      }
      return;
    }
    if (selectedRelayId && pendingRelaySelectionRef.current === selectedRelayId) return;
    setSelectedRelayId(relays[0]?.id ?? null);
  }, [relays, selectedRelayId]);

  const run = useMemo(
    () => runs.find((entry) => entry.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );
  const task = useMemo(
    () => tasks.find((entry) => entry.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks]
  );
  const taskRun = useMemo(
    () => runs.find((entry) => entry.id === (task?.runId ?? '')) ?? null,
    [runs, task?.runId]
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
  const { task: liveTask, events: taskEvents } = useTaskStream(selectedTaskId, task);
  const { run: liveTaskRun, logs: taskLogs } = useRunStream(task?.runId ?? null, taskRun);
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
  const canLaunchTask =
    !isLaunchingTask &&
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
    () => resolveRelayTemplate(relayTemplateId, relayStarter, isChinese, customRelayTemplates),
    [customRelayTemplates, isChinese, relayStarter, relayTemplateId]
  );
  const currentPinnedRules = useMemo(
    () => parsePinnedRulesDraft(relayPinnedRulesDraft),
    [relayPinnedRulesDraft]
  );
  const relayParticipants = useMemo(
    () => orderRelayParticipants(relayTemplate.participants, relayStarter),
    [relayStarter, relayTemplate.participants]
  );
  const isEditingCustomRelayTemplate = editingCustomRelayTemplateId !== null;
  const customRelayTemplateActionLabel = isChinese
    ? isEditingCustomRelayTemplate
      ? '更新模板'
      : '保存模板'
    : isEditingCustomRelayTemplate
      ? 'Update'
      : 'Save';
  const customRelayTemplateHelpText = isChinese
    ? isEditingCustomRelayTemplate
      ? '会用当前参与者、system prompt、长期规则、起始 agent 和轮数覆盖这个已保存模板。'
      : '会保存当前参与者、system prompt、长期规则、起始 agent 和轮数。'
    : isEditingCustomRelayTemplate
      ? 'Overwrites this saved template with the current participants, system prompt, pinned rules, starter, and turn count.'
      : 'Saves the current participants, system prompt, pinned rules, starter, and turn count.';

  const presets = useMemo(
    () => buildPresets(activeSession, provider, isChinese),
    [activeSession, isChinese, provider]
  );
  const relayPromptIdeas = relayTemplate.promptIdeas ?? [];
  const surfaceMeta = useMemo(() => {
    if (surface === 'task') {
      return {
        title: isChinese ? '任务闭环' : 'Task loop',
        description: isChinese
          ? '从任务、分支、测试到 PR 的交付回路。'
          : 'A delivery loop from branch creation to tests and PR.',
        count: tasks.length,
        focus: liveTask?.title ?? (isChinese ? '选择一个任务或新建一个 task loop。' : 'Pick a task or start a new task loop.'),
      };
    }

    if (surface === 'run') {
      return {
        title: isChinese ? '无头运行' : 'Headless run',
        description: isChinese
          ? '适合一次性后台执行，持续回流日志。'
          : 'Best for one-shot background execution with streamed logs.',
        count: runs.length,
        focus:
          liveRun?.command.join(' ') ??
          (isChinese ? '选择一个 run 查看执行输出。' : 'Pick a run to inspect the execution output.'),
      };
    }

    if (surface === 'terminal') {
      return {
        title: isChinese ? '交互终端' : 'Interactive terminal',
        description: isChinese
          ? '保留上下文并支持继续输入。'
          : 'Keeps context alive and accepts follow-up input.',
        count: terminals.length,
        focus:
          liveTerminal?.command.join(' ') ??
          (isChinese ? '选择一个 terminal 或直接从浏览器对话拉起。' : 'Pick a terminal or auto-start one from browser chat.'),
      };
    }

    return {
      title: isChinese ? 'Agent 房间' : 'Agent room',
      description: isChinese
        ? '多智能体讨论、人工介入和房间总结。'
        : 'Multi-agent discussion with steering, summaries, and controls.',
      count: relays.length,
      focus:
        liveRelay?.title ??
        (isChinese ? '选择一个 relay 房间或从右侧模板发起。' : 'Pick a relay room or launch one from the right rail.'),
    };
  }, [isChinese, liveRelay?.title, liveRun?.command, liveTask?.title, liveTerminal?.command, relays.length, runs.length, surface, tasks.length, terminals.length]);

  useEffect(() => {
    if (isBuiltinRelayTemplateId(relayTemplateId)) return;
    if (customRelayTemplates.some((entry) => entry.id === relayTemplateId)) return;
    setRelayTemplateId('duel');
  }, [customRelayTemplates, relayTemplateId]);

  useEffect(() => {
    if (relayPinnedRulesDraft.trim().length > 0) return;
    if (relayTemplate.defaultPinnedRules.length === 0) return;
    setRelayPinnedRulesDraft(relayTemplate.defaultPinnedRules.join('\n'));
  }, [relayPinnedRulesDraft, relayTemplate.defaultPinnedRules]);

  const applyRelayTemplateSelection = (
    nextTemplateId: RelayTemplateId,
    options?: { preserveEditing?: boolean }
  ) => {
    const nextTemplate = resolveRelayTemplate(
      nextTemplateId,
      relayStarter,
      isChinese,
      customRelayTemplates
    );
    setRelayTemplateError(null);
    if (!options?.preserveEditing) {
      setEditingCustomRelayTemplateId(null);
      setCustomRelayTemplateName('');
    }
    setRelayTemplateId(nextTemplateId);
    setRelayPinnedRulesDraft(nextTemplate.defaultPinnedRules.join('\n'));

    if (nextTemplate.custom) {
      setRelayStarter(nextTemplate.starter ?? relayStarter);
      setRelaySystemPrompt(nextTemplate.systemPrompt ?? '');
      setRelayMaxTurns(nextTemplate.maxTurns ?? 4);
      return;
    }

    setRelaySystemPrompt('');
  };

  const startEditingCustomRelayTemplate = (template: CustomRelayTemplateRecord) => {
    applyRelayTemplateSelection(template.id, { preserveEditing: true });
    setEditingCustomRelayTemplateId(template.id);
    setCustomRelayTemplateName(template.name);
    setRelayTemplateError(null);
  };

  const cancelEditingCustomRelayTemplate = () => {
    setEditingCustomRelayTemplateId(null);
    setCustomRelayTemplateName('');
    setRelayTemplateError(null);
  };

  const saveCustomRelayTemplate = () => {
    const templateName = customRelayTemplateName.trim();
    if (!templateName) {
      setRelayTemplateError(
        isChinese ? '先输入一个模板名字。' : 'Add a template name before saving.'
      );
      return;
    }

    const nextTemplate: CustomRelayTemplateRecord = {
      id: editingCustomRelayTemplateId ?? `custom-${Date.now()}`,
      name: templateName,
      participants: relayParticipants,
      description:
        relayTemplate.description ||
        (isChinese ? '自定义房间模板' : 'Custom room template'),
      defaultPinnedRules: currentPinnedRules,
      systemPrompt: relaySystemPrompt.trim() || undefined,
      starter: relayStarter,
      maxTurns: relayMaxTurns,
    };

    const nextTemplates = editingCustomRelayTemplateId
      ? customRelayTemplates.map((entry) =>
          entry.id === editingCustomRelayTemplateId ? nextTemplate : entry
        )
      : [nextTemplate, ...customRelayTemplates].slice(0, 12);
    setCustomRelayTemplates(nextTemplates);
    writeCustomRelayTemplates(nextTemplates);
    setCustomRelayTemplateName('');
    setEditingCustomRelayTemplateId(null);
    setRelayTemplateError(null);
    applyRelayTemplateSelection(nextTemplate.id);
  };

  const removeCustomRelayTemplate = (templateId: string) => {
    const nextTemplates = customRelayTemplates.filter((entry) => entry.id !== templateId);
    setCustomRelayTemplates(nextTemplates);
    writeCustomRelayTemplates(nextTemplates);
    if (editingCustomRelayTemplateId === templateId) {
      cancelEditingCustomRelayTemplate();
    }
    if (relayTemplateId === templateId) {
      applyRelayTemplateSelection('duel');
    }
  };

  const launchTask = async () => {
    if (!canLaunchTask) return;
    setIsLaunchingTask(true);
    setTaskError(null);

    try {
      const payload: StartAgentTaskRequestDTO = {
        title: taskTitle.trim() || undefined,
        provider,
        mode,
        cwd: cwd.trim(),
        prompt: prompt.trim(),
        issueUrl: taskIssueUrl.trim() || undefined,
        sessionUid: mode === 'resume' ? activeSession?.uid : undefined,
        testCommand: taskTestCommand.trim() || undefined,
      };
      const { response, data } = await requestJson<{ task?: AgentTaskDTO; error?: string }>(
        '/api/tasks',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        isChinese ? '启动 Task Loop 超时，请检查服务端是否正常。' : 'Starting the task loop timed out. Check whether the server is still responding.'
      );
      if (!response.ok || !data.task) {
        throw new Error(data.error ?? 'Failed to start task.');
      }
      pendingTaskSelectionRef.current = data.task.id;
      startTransition(() => {
        setSurface('task');
        setSelectedTaskId(data.task!.id);
      });
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : 'Failed to start task.');
    } finally {
      setIsLaunchingTask(false);
    }
  };

  const importTaskIssue = async () => {
    if (!taskIssueUrl.trim() || isImportingTaskIssue) return;
    setIsImportingTaskIssue(true);
    setTaskError(null);

    try {
      const response = await fetch('/api/tasks/import-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueUrl: taskIssueUrl.trim(), cwd: cwd.trim() || undefined }),
      });
      const data = (await response.json()) as {
        draft?: ImportedGitHubIssueDraftDTO;
        error?: string;
      };
      if (!response.ok || !data.draft) {
        throw new Error(data.error ?? 'Failed to import issue.');
      }
      setTaskTitle(data.draft.title);
      setPrompt(data.draft.prompt);
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : 'Failed to import issue.');
    } finally {
      setIsImportingTaskIssue(false);
    }
  };

  const refreshTaskArtifacts = async (rerunTests = false) => {
    if (!liveTask || isRefreshingTask) return;
    setIsRefreshingTask(true);
    setTaskError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(liveTask.id)}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rerunTests }),
      });
      const data = (await response.json()) as { task?: AgentTaskDTO; error?: string };
      if (!response.ok || !data.task) {
        throw new Error(data.error ?? 'Failed to refresh task.');
      }
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : 'Failed to refresh task.');
    } finally {
      setIsRefreshingTask(false);
    }
  };

  const createTaskPullRequest = async () => {
    if (!liveTask || isCreatingTaskPr) return;
    setIsCreatingTaskPr(true);
    setTaskError(null);
    try {
      const response = await fetch(
        `/api/tasks/${encodeURIComponent(liveTask.id)}/pull-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const data = (await response.json()) as { task?: AgentTaskDTO; error?: string };
      if (!response.ok || !data.task) {
        throw new Error(data.error ?? 'Failed to create pull request.');
      }
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : 'Failed to create pull request.');
    } finally {
      setIsCreatingTaskPr(false);
    }
  };

  const reviewTaskPullRequest = async (event: 'APPROVE' | 'REQUEST_CHANGES') => {
    if (!liveTask?.pullRequest || isReviewingTaskPr) return;
    setIsReviewingTaskPr(true);
    setTaskError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(liveTask.id)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event }),
      });
      const data = (await response.json()) as { task?: AgentTaskDTO; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to review pull request.');
      }
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : 'Failed to review pull request.');
    } finally {
      setIsReviewingTaskPr(false);
    }
  };

  const mergeTaskPullRequest = async () => {
    if (!liveTask?.pullRequest || isMergingTaskPr) return;
    setIsMergingTaskPr(true);
    setTaskError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(liveTask.id)}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'squash' }),
      });
      const data = (await response.json()) as { task?: AgentTaskDTO; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to merge pull request.');
      }
    } catch (reason) {
      setTaskError(reason instanceof Error ? reason.message : 'Failed to merge pull request.');
    } finally {
      setIsMergingTaskPr(false);
    }
  };

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
      const { response, data } = await requestJson<{ run?: RunSessionDTO; error?: string }>(
        '/api/runs',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        isChinese ? '启动 headless run 超时，请检查服务端是否正常。' : 'Starting the headless run timed out. Check whether the server is still responding.'
      );
      if (!response.ok || !data.run) {
        throw new Error(data.error ?? 'Failed to start run.');
      }
      pendingRunSelectionRef.current = data.run.id;
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
    const { response, data } = await requestJson<{
      terminal?: TerminalSessionDTO;
      error?: string;
    }>(
      '/api/terminals',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      isChinese ? '打开交互式终端超时，请检查服务端是否正常。' : 'Opening the interactive terminal timed out. Check whether the server is still responding.'
    );
    if (!response.ok || !data.terminal) {
      throw new Error(data.error ?? 'Failed to open terminal.');
    }
    pendingTerminalSelectionRef.current = data.terminal.id;
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
        await sendTerminalInput(liveTerminal.id, normalizeChatInput(message), {
          timeoutMessage: isChinese ? '消息发送超时，请检查终端连接是否正常。' : 'Sending the message timed out. Check whether the terminal connection is still healthy.',
          errorMessage: isChinese ? '发送消息到终端失败。' : 'Failed to send the message to the terminal.',
        });
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
        starter: relayStarter,
        participants: relayParticipants,
        systemPrompt: relaySystemPrompt.trim() || undefined,
        initialPinnedRules: currentPinnedRules,
        maxTurns: relayMaxTurns,
        title: relayPrompt.trim(),
      };
      const { response, data } = await requestJson<{
        relay?: AgentRelaySessionDTO;
        error?: string;
      }>(
        '/api/relays',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        isChinese ? '启动 Agent Relay 超时，请检查服务端是否正常。' : 'Starting the agent relay timed out. Check whether the server is still responding.'
      );
      if (!response.ok || !data.relay) {
        throw new Error(data.error ?? 'Failed to start relay.');
      }
      pendingRelaySelectionRef.current = data.relay.id;
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

  const toggleRelayInterventionPin = async (
    interventionId: string,
    pinned: boolean
  ) => {
    if (!liveRelay || isPinningRelayIntervention) return;
    setIsPinningRelayIntervention(interventionId);
    setRelayInterventionError(null);

    try {
      const response = await fetch(
        `/api/relays/${encodeURIComponent(liveRelay.id)}/interventions/${encodeURIComponent(interventionId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned }),
        }
      );
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to update rule pin.');
      }
    } catch (reason) {
      setRelayInterventionError(
        reason instanceof Error ? reason.message : 'Failed to update rule pin.'
      );
    } finally {
      setIsPinningRelayIntervention(null);
    }
  };

  const moveRelayIntervention = async (
    interventionId: string,
    direction: 'up' | 'down'
  ) => {
    if (!liveRelay || isMovingRelayIntervention) return;
    setIsMovingRelayIntervention(interventionId);
    setRelayInterventionError(null);

    try {
      const response = await fetch(
        `/api/relays/${encodeURIComponent(liveRelay.id)}/interventions/${encodeURIComponent(interventionId)}/move`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction }),
        }
      );
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? 'Failed to move pinned rule.');
      }
    } catch (reason) {
      setRelayInterventionError(
        reason instanceof Error ? reason.message : 'Failed to move pinned rule.'
      );
    } finally {
      setIsMovingRelayIntervention(null);
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
    setTaskTitle('');
    setTaskIssueUrl('');
    setTaskTestCommand('');
    setPrompt('');
    setRelayPrompt('');
    setRelayPinnedRulesDraft('');
    setRelaySystemPrompt('');
    setRunError(null);
    setTaskError(null);
    setTerminalError(null);
    setChatError(null);
    setRelayError(null);
    setRelayTemplateError(null);
    setRelayInterventionError(null);
    setChatDraft('');
    setCustomRelayTemplateName('');
    setEditingCustomRelayTemplateId(null);
    setRelayInterventionDraft('');
    setEditingRelayInterventionId(null);
    setIsRemovingRelayIntervention(null);
    setIsMovingRelayIntervention(null);
    setIsPinningRelayIntervention(null);
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
          <Badge className={streamBadgeClass(taskStatus)}>
            {isChinese ? 'tasks' : 'tasks'} {taskStatus === 'open' ? 'live' : 'syncing'}
          </Badge>
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

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                <span>{isChinese ? 'GitHub issue' : 'GitHub issue'}</span>
                <span className="normal-case tracking-normal text-slate-400">
                  {isChinese ? '可选' : 'optional'}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  value={taskIssueUrl}
                  onChange={(event) => setTaskIssueUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo/issues/123"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => void importTaskIssue()}
                  disabled={!taskIssueUrl.trim() || isImportingTaskIssue}
                >
                  {isImportingTaskIssue ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <GitPullRequestArrow className="h-4 w-4" />
                  )}
                  {isChinese ? '导入' : 'Import'}
                </Button>
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'Task title' : 'Task title'}
              </div>
              <input
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder={isChinese ? '例如：实现 GitHub task loop' : 'For example: Ship the GitHub task loop'}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                <span>{isChinese ? 'Test command' : 'Test command'}</span>
                <span className="normal-case tracking-normal text-slate-400">
                  {isChinese ? '可选' : 'optional'}
                </span>
              </div>
              <input
                value={taskTestCommand}
                onChange={(event) => setTaskTestCommand(event.target.value)}
                placeholder={isChinese ? '例如：corepack pnpm test' : 'For example: corepack pnpm test'}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
              />
            </div>

            {!canResume && mode === 'resume' ? (
              <InlineNotice tone="warn">
                {isChinese
                  ? '请先选择同一 provider 的会话，再尝试恢复。'
                  : 'Select a session from the same provider before trying to resume it.'}
              </InlineNotice>
            ) : null}
            {taskError ? <InlineNotice tone="error">{taskError}</InlineNotice> : null}
            {runError ? <InlineNotice tone="error">{runError}</InlineNotice> : null}
            {terminalError ? <InlineNotice tone="error">{terminalError}</InlineNotice> : null}

            <div className="mt-4 grid gap-2">
              <Button
                onClick={() => void launchTask()}
                disabled={!canLaunchTask}
                className="w-full rounded-xl bg-[var(--theme-secondary-solid)] text-[var(--theme-secondary-foreground)] hover:bg-[var(--theme-secondary-solid-hover)]"
              >
                {isLaunchingTask ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <GitBranch className="h-4 w-4" />
                )}
                {isChinese ? '启动 Task Loop' : 'Start task loop'}
              </Button>
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
                  onClick={() => applyRelayTemplateSelection(templateId)}
                  label={relayTemplateLabel(templateId, isChinese)}
                />
              ))}
            </div>

            {customRelayTemplates.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {isChinese ? '自定义模板' : 'Saved templates'}
                  </div>
                  <Badge variant="muted" className="bg-white/5 text-slate-300">
                    {customRelayTemplates.length}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {customRelayTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs',
                        relayTemplateId === template.id
                          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
                          : 'border-white/10 bg-black/20 text-slate-300',
                        editingCustomRelayTemplateId === template.id &&
                          'shadow-[0_0_0_1px_var(--theme-secondary-border)]'
                      )}
                    >
                      <button type="button" onClick={() => applyRelayTemplateSelection(template.id)}>
                        {template.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditingCustomRelayTemplate(template)}
                        className="text-slate-400 transition hover:text-white"
                        aria-label={isChinese ? '编辑模板' : 'Edit template'}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCustomRelayTemplate(template.id)}
                        className="text-slate-400 transition hover:text-white"
                        aria-label={isChinese ? '删除模板' : 'Delete template'}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

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
                {relayParticipants.map((participant) => (
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
            {currentPinnedRules.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-violet-100">
                  <Pin className="h-3.5 w-3.5" />
                  {isChinese ? '长期规则预览' : 'Pinned rules preview'}
                </div>
                <div className="mt-2 space-y-2">
                  {currentPinnedRules.map((rule, index) => (
                    <div
                      key={`${relayTemplateId}-rule-${index + 1}`}
                      className="rounded-xl border border-violet-300/15 bg-black/20 px-3 py-2 text-sm text-violet-50"
                    >
                      <div className="text-[11px] uppercase tracking-[0.18em] text-violet-200/80">
                        {isChinese ? `规则 ${index + 1}` : `Rule ${index + 1}`}
                      </div>
                      <div className="mt-1 whitespace-pre-wrap break-words">{rule}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                <span>{isChinese ? '长期规则' : 'Pinned rules'}</span>
                <span className="normal-case tracking-normal text-slate-400">
                  {isChinese ? '每行一条' : 'one per line'}
                </span>
              </div>
              <textarea
                value={relayPinnedRulesDraft}
                onChange={(event) => setRelayPinnedRulesDraft(event.target.value)}
                rows={4}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                placeholder={
                  isChinese
                    ? '输入房间长期规则，每行一条。比如：先统一结论，再给行动计划。'
                    : 'Enter long-running room rules, one per line. For example: align on one conclusion before giving an action plan.'
                }
              />
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? '保存为模板' : 'Save as template'}
                </div>
                <Badge variant="muted" className="bg-white/5 text-slate-300">
                  {customRelayTemplates.length}
                </Badge>
              </div>
              {editingCustomRelayTemplateId ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] px-3 py-2 text-sm text-[var(--theme-accent-text)]">
                  <span>
                    {isChinese
                      ? `正在编辑模板：${customRelayTemplateName || '未命名模板'}`
                      : `Editing template: ${customRelayTemplateName || 'Untitled template'}`}
                  </span>
                  <button
                    type="button"
                    onClick={cancelEditingCustomRelayTemplate}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white transition hover:bg-white/10"
                  >
                    {isChinese ? '取消' : 'Cancel'}
                  </button>
                </div>
              ) : null}
              <div className="mt-3 flex gap-2">
                <input
                  value={customRelayTemplateName}
                  onChange={(event) => setCustomRelayTemplateName(event.target.value)}
                  placeholder={isChinese ? '例如：我的交付房间' : 'For example: My shipping room'}
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                />
                <Button
                  type="button"
                  onClick={saveCustomRelayTemplate}
                  aria-label={customRelayTemplateActionLabel}
                  title={customRelayTemplateActionLabel}
                  className="rounded-xl bg-[var(--theme-accent-solid)] text-[var(--theme-accent-foreground)] hover:bg-[var(--theme-accent-solid-hover)]"
                >
                  {isChinese ? '保存' : 'Save'}
                </Button>
              </div>
              <div className="mt-2 text-xs text-slate-400">{customRelayTemplateHelpText}</div>
              <div className="hidden text-xs text-slate-400">
                {isChinese
                  ? '会保存当前参与者、system prompt、长期规则、起始 agent 和轮数。'
                  : 'Saves the current participants, system prompt, pinned rules, starter, and turn count.'}
              </div>
            </div>

            {relayTemplateError ? <InlineNotice tone="error">{relayTemplateError}</InlineNotice> : null}
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
                {tasks.length + runs.length + terminals.length + relays.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {tasks.slice(0, 4).map((entry) => (
                <PickerRow
                  key={entry.id}
                  active={entry.id === selectedTaskId && surface === 'task'}
                  label={entry.title}
                  sublabel={entry.branchName}
                  badge={entry.status}
                  badgeClass={taskBadgeClass(entry.status)}
                  onClick={() => {
                    pendingTaskSelectionRef.current = null;
                    setSurface('task');
                    setSelectedTaskId(entry.id);
                  }}
                />
              ))}
              {runs.slice(0, 4).map((entry) => (
                <PickerRow
                  key={entry.id}
                  active={entry.id === selectedRunId && surface === 'run'}
                  label={`${entry.provider} ${entry.mode === 'resume' ? 'resume' : 'task'}`}
                  sublabel={entry.cwd}
                  badge={entry.status}
                  badgeClass={runBadgeClass(entry.status)}
                  onClick={() => {
                    pendingRunSelectionRef.current = null;
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
                    pendingTerminalSelectionRef.current = null;
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
                    pendingRelaySelectionRef.current = null;
                    setSurface('relay');
                    setSelectedRelayId(entry.id);
                  }}
                />
              ))}
              {tasks.length === 0 && runs.length === 0 && terminals.length === 0 && relays.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-5 text-sm text-slate-400">
                  {isChinese
                    ? '还没有活动记录，先启动一个 run 或 terminal 吧。'
                    : 'No activity yet. Launch a task, run, terminal, or relay to begin.'}
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
              active={surface === 'task'}
              onClick={() => setSurface('task')}
              icon={GitBranch}
              label={isChinese ? 'Task loop' : 'Task loop'}
            />
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

          {surface === 'task' ? (
            <TaskLoopPane
              task={liveTask}
              tasks={tasks}
              events={taskEvents}
              logs={taskLogs}
              run={liveTaskRun}
              isRefreshing={isRefreshingTask}
              isCreatingPullRequest={isCreatingTaskPr}
              isReviewingPullRequest={isReviewingTaskPr}
              isMergingPullRequest={isMergingTaskPr}
              taskError={taskError}
              onPick={setSelectedTaskId}
              onRefresh={(rerunTests) => void refreshTaskArtifacts(rerunTests)}
              onStop={(taskId) => void stopAgentTask(taskId)}
              onCreatePullRequest={() => void createTaskPullRequest()}
              onApprove={() => void reviewTaskPullRequest('APPROVE')}
              onRequestChanges={() => void reviewTaskPullRequest('REQUEST_CHANGES')}
              onMerge={() => void mergeTaskPullRequest()}
            />
          ) : surface === 'run' ? (
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
              movingInterventionId={isMovingRelayIntervention}
              pinningInterventionId={isPinningRelayIntervention}
              removingInterventionId={isRemovingRelayIntervention}
              onInterventionDraftChange={setRelayInterventionDraft}
              onCancelInterventionEdit={cancelEditingRelayIntervention}
              onEditIntervention={startEditingRelayIntervention}
              onMoveIntervention={(id, direction) =>
                void moveRelayIntervention(id, direction)
              }
              onToggleInterventionPin={(id, pinned) =>
                void toggleRelayInterventionPin(id, pinned)
              }
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

function TaskLoopPane({
  task,
  tasks,
  run,
  logs,
  events,
  taskError,
  isRefreshing,
  isCreatingPullRequest,
  isReviewingPullRequest,
  isMergingPullRequest,
  onPick,
  onRefresh,
  onStop,
  onCreatePullRequest,
  onApprove,
  onRequestChanges,
  onMerge,
}: {
  task: AgentTaskDTO | null;
  tasks: AgentTaskDTO[];
  run: RunSessionDTO | null;
  logs: { id: string; text: string; stream: 'stdout' | 'stderr' | 'system'; timestampMs: number }[];
  events: AgentTaskEventDTO[];
  taskError: string | null;
  isRefreshing: boolean;
  isCreatingPullRequest: boolean;
  isReviewingPullRequest: boolean;
  isMergingPullRequest: boolean;
  onPick: (id: string) => void;
  onRefresh: (rerunTests: boolean) => void;
  onStop: (id: string) => void;
  onCreatePullRequest: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onMerge: () => void;
}) {
  const { isChinese, language } = useI18n();
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const recentReviews = task
    ? [...task.pullRequestReviews]
        .sort((left, right) => (right.submittedAtMs ?? 0) - (left.submittedAtMs ?? 0))
        .slice(0, 6)
    : [];
  const recentComments = task
    ? [...task.pullRequestComments]
        .sort(
          (left, right) =>
            (right.updatedAtMs ?? right.createdAtMs) - (left.updatedAtMs ?? left.createdAtMs)
        )
        .slice(0, 6)
    : [];
  const recentChecks = task
    ? [...task.checks]
        .sort((left, right) => githubCheckSortOrder(left) - githubCheckSortOrder(right))
        .slice(0, 8)
    : [];

  useEffect(() => {
    const el = logViewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <section className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {isChinese ? 'Task loop' : 'Task loop'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {task ? task.title : isChinese ? '选择一个任务' : 'Select a task'}
          </div>
        </div>
        {task ? <Badge className={taskBadgeClass(task.status)}>{task.status}</Badge> : null}
      </div>

      <div className="mb-3 space-y-2">
        {tasks.slice(0, 6).map((entry) => (
          <PickerRow
            key={entry.id}
            active={task?.id === entry.id}
            label={entry.title}
            sublabel={`${entry.baseBranch} -> ${entry.branchName}`}
            badge={entry.status}
            badgeClass={taskBadgeClass(entry.status)}
            onClick={() => onPick(entry.id)}
          />
        ))}
        {tasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-5 text-sm text-slate-400">
            {isChinese ? '先启动一个任务分支。' : 'Start a task branch to begin.'}
          </div>
        ) : null}
      </div>

      {task ? (
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'Task summary' : 'Task summary'}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <InfoPair label="Repo" value={task.repoName} />
                <InfoPair label="Provider" value={task.provider} />
                <InfoPair label="Base" value={task.baseBranch} />
                <InfoPair label="Branch" value={task.branchName} />
                <InfoPair label="Run" value={task.runId ?? (isChinese ? '未绑定' : 'Not attached')} />
                <InfoPair label="Tests" value={task.testResult.status} />
              </div>
              {task.sourceIssue ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {isChinese ? 'Linked issue' : 'Linked issue'}
                  </div>
                  <a
                    href={task.sourceIssue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-[var(--theme-accent-text)] underline-offset-4 hover:underline"
                  >
                    #{task.sourceIssue.number} {task.sourceIssue.title}
                  </a>
                </div>
              ) : null}
              {task.pullRequest ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      {isChinese ? 'Merge readiness' : 'Merge readiness'}
                    </div>
                    <Badge
                      className={
                        task.mergeReadiness?.ready
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                          : 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                      }
                    >
                      {task.mergeReadiness?.ready ? 'ready' : 'needs attention'}
                    </Badge>
                  </div>
                  {task.pullRequest.mergeStateStatus ? (
                    <div className="mt-2 text-xs text-slate-400">
                      merge state: {task.pullRequest.mergeStateStatus}
                    </div>
                  ) : null}
                  {task.mergeReadiness?.reasons.length ? (
                    <div className="mt-2 space-y-1 text-xs text-slate-300">
                      {task.mergeReadiness.reasons.map((reason, index) => (
                        <div key={`${task.id}-reason-${index + 1}`}>- {reason}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-slate-400">
                      {isChinese ? '当前没有检测到明显的 merge 阻塞。' : 'No obvious merge blockers detected right now.'}
                    </div>
                  )}
                </div>
              ) : null}
              {task.github.connected ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                  <div className="flex items-center justify-between gap-2">
                    <span>GitHub</span>
                    <Badge
                      className={
                        task.github.tokenConfigured
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                          : 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                      }
                    >
                      {task.github.tokenConfigured ? 'token ready' : 'token missing'}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    {task.github.owner}/{task.github.name}
                  </div>
                  {task.pullRequest ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a
                        href={task.pullRequest.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[var(--theme-accent-text)] underline-offset-4 hover:underline"
                      >
                        <GitPullRequestArrow className="h-3.5 w-3.5" />
                        PR #{task.pullRequest.number}
                      </a>
                      <Badge className="border-white/15 bg-white/[0.06] text-slate-200">
                        {task.pullRequest.state}
                      </Badge>
                    </div>
                  ) : task.github.compareUrl ? (
                    <a
                      href={task.github.compareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--theme-accent-text)] underline-offset-4 hover:underline"
                    >
                      <GitPullRequestArrow className="h-3.5 w-3.5" />
                      {isChinese ? '查看 compare' : 'Open compare'}
                    </a>
                  ) : null}
                </div>
              ) : (
                <InlineNotice tone="warn">
                  {isChinese
                    ? '当前仓库没有可识别的 GitHub origin remote。'
                    : 'This repository does not expose a GitHub origin remote.'}
                </InlineNotice>
              )}
              {task.branchCleanup ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {isChinese ? 'Post-merge cleanup' : 'Post-merge cleanup'}
                  </div>
                  <div className="mt-2 text-xs text-slate-300">
                    {task.branchCleanup.message}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'Actions' : 'Actions'}
              </div>
              <div className="mt-3 grid gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => onRefresh(false)}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isChinese ? '刷新 diff' : 'Refresh diff'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => onRefresh(true)}
                  disabled={isRefreshing || !task.testCommand}
                >
                  <Command className="h-4 w-4" />
                  {isChinese ? '重新跑测试' : 'Rerun tests'}
                </Button>
                {task.status === 'preparing' || task.status === 'running' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                    onClick={() => onStop(task.id)}
                  >
                    <Square className="h-4 w-4" />
                    {isChinese ? '停止任务' : 'Stop task'}
                  </Button>
                ) : null}
                {!task.pullRequest ? (
                  <Button
                    size="sm"
                    className="bg-[var(--theme-accent-solid)] text-[var(--theme-accent-foreground)] hover:bg-[var(--theme-accent-solid-hover)]"
                    onClick={onCreatePullRequest}
                    disabled={isCreatingPullRequest}
                  >
                    {isCreatingPullRequest ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <GitPullRequestArrow className="h-4 w-4" />
                    )}
                    {isChinese ? 'Commit & open PR' : 'Commit & open PR'}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                      onClick={onApprove}
                      disabled={isReviewingPullRequest}
                    >
                      {isReviewingPullRequest ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {isChinese ? 'Approve PR' : 'Approve PR'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                      onClick={onRequestChanges}
                      disabled={isReviewingPullRequest}
                    >
                      <MessageSquare className="h-4 w-4" />
                      {isChinese ? 'Request changes' : 'Request changes'}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-[var(--theme-secondary-solid)] text-[var(--theme-secondary-foreground)] hover:bg-[var(--theme-secondary-solid-hover)]"
                      onClick={onMerge}
                      disabled={isMergingPullRequest || Boolean(task.mergeReadiness && !task.mergeReadiness.ready)}
                    >
                      {isMergingPullRequest ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GitPullRequestArrow className="h-4 w-4" />}
                      {isChinese ? 'Merge PR' : 'Merge PR'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {taskError ? <InlineNotice tone="error">{taskError}</InlineNotice> : null}

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'Diff stat' : 'Diff stat'}
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-200">
                {task.diffStat ?? (isChinese ? '暂无 diff。' : 'No diff summary yet.')}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                {task.changedFiles.map((file) => (
                  <Badge key={`${file.status}-${file.path}`} variant="muted" className="bg-white/5 text-slate-300">
                    {file.status}: {file.path}
                  </Badge>
                ))}
                {task.changedFiles.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    {isChinese ? '还没有检测到文件变化。' : 'No changed files detected yet.'}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'Test output' : 'Test output'}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Badge className={taskTestBadgeClass(task.testResult.status)}>
                  {task.testResult.status}
                </Badge>
                {task.testResult.command ? (
                  <span className="text-xs text-slate-400">{task.testResult.command}</span>
                ) : null}
              </div>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-200">
                {task.testResult.output || (isChinese ? '没有测试输出。' : 'No test output yet.')}
              </pre>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? '检查与保护规则' : 'Checks & protection'}
                </div>
                {task.pullRequest ? (
                  <Badge className="border-white/15 bg-white/[0.06] text-slate-200">
                    {task.checks.length} {isChinese ? '项检查' : 'checks'}
                  </Badge>
                ) : null}
              </div>

              {!task.pullRequest ? (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-5 text-sm text-slate-400">
                  {isChinese
                    ? '先创建 PR，这里才会同步 GitHub checks 和 branch protection。'
                    : 'Open a PR first, then this panel will sync GitHub checks and branch protection.'}
                </div>
              ) : (
                <>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                        {isChinese ? '分支保护' : 'Branch protection'}
                      </div>
                      <Badge
                        className={
                          task.branchProtection?.enabled
                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
                            : 'border-white/15 bg-white/[0.06] text-slate-200'
                        }
                      >
                        {task.branchProtection?.enabled
                          ? isChinese
                            ? '已启用'
                            : 'enabled'
                          : isChinese
                            ? '未启用'
                            : 'not enforced'}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <InfoPair
                        label={isChinese ? '需要审批' : 'Approvals'}
                        value={
                          task.branchProtection?.requiredApprovingReviewCount
                            ? String(task.branchProtection.requiredApprovingReviewCount)
                            : isChinese
                              ? '无要求'
                              : 'Not required'
                        }
                      />
                      <InfoPair
                        label={isChinese ? '严格检查' : 'Strict checks'}
                        value={
                          task.branchProtection?.strictStatusChecks
                            ? isChinese
                              ? '是'
                              : 'Yes'
                            : isChinese
                              ? '否'
                              : 'No'
                        }
                      />
                      <InfoPair
                        label={isChinese ? '过期评审失效' : 'Stale review reset'}
                        value={
                          task.branchProtection?.dismissesStaleReviews
                            ? isChinese
                              ? '是'
                              : 'Yes'
                            : isChinese
                              ? '否'
                              : 'No'
                        }
                      />
                      <InfoPair
                        label={isChinese ? '需解决对话' : 'Conversation resolution'}
                        value={
                          task.branchProtection?.requiresConversationResolution
                            ? isChinese
                              ? '是'
                              : 'Yes'
                            : isChinese
                              ? '否'
                              : 'No'
                        }
                      />
                    </div>
                    {task.branchProtection?.requiredCheckContexts.length ? (
                      <div className="mt-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                          {isChinese ? '必需检查' : 'Required checks'}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {task.branchProtection.requiredCheckContexts.map((context) => (
                            <Badge
                              key={`${task.id}-required-check-${context}`}
                              variant="muted"
                              className="bg-white/5 text-slate-300"
                            >
                              {context}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {task.branchProtection?.lastError ? (
                      <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                        {task.branchProtection.lastError}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {recentChecks.map((check) => (
                      <div
                        key={check.id}
                        className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-200"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-slate-100">{check.name}</div>
                          <Badge className={githubCheckBadgeClass(check.status, check.conclusion)}>
                            {check.status}
                            {check.conclusion ? ` / ${check.conclusion}` : ''}
                          </Badge>
                        </div>
                        {check.details ? (
                          <div className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-400">
                            {check.details}
                          </div>
                        ) : null}
                        {check.url ? (
                          <a
                            href={check.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--theme-accent-text)] underline-offset-4 hover:underline"
                          >
                            <GitPullRequestArrow className="h-3.5 w-3.5" />
                            {isChinese ? '在 GitHub 中查看' : 'Open on GitHub'}
                          </a>
                        ) : null}
                      </div>
                    ))}
                    {recentChecks.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-5 text-sm text-slate-400">
                        {isChinese ? 'GitHub 还没有返回任何 check run。' : 'GitHub has not reported any check runs yet.'}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? 'PR 活动' : 'PR activity'}
                </div>
                {task.pullRequest ? (
                  <Badge className="border-white/15 bg-white/[0.06] text-slate-200">
                    {task.pullRequestReviews.length + task.pullRequestComments.length}{' '}
                    {isChinese ? '条记录' : 'entries'}
                  </Badge>
                ) : null}
              </div>

              {!task.pullRequest ? (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-5 text-sm text-slate-400">
                  {isChinese
                    ? '先创建 PR，这里才会同步 review 和 comment 时间线。'
                    : 'Open a PR first, then this panel will sync review and comment activity.'}
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      {isChinese ? '评审' : 'Reviews'}
                    </div>
                    <div className="mt-3 space-y-2">
                      {recentReviews.map((review) => (
                        <div
                          key={review.id}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-200"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-100">{review.author}</span>
                              <Badge className={githubReviewBadgeClass(review.state)}>{review.state}</Badge>
                            </div>
                            <span className="text-[11px] text-slate-500">
                              {formatTaskTimestamp(review.submittedAtMs, language, isChinese)}
                            </span>
                          </div>
                          {review.body ? (
                            <div className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-300">
                              {review.body}
                            </div>
                          ) : null}
                          {review.url ? (
                            <a
                              href={review.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--theme-accent-text)] underline-offset-4 hover:underline"
                            >
                              <GitPullRequestArrow className="h-3.5 w-3.5" />
                              {isChinese ? '在 GitHub 中查看' : 'Open on GitHub'}
                            </a>
                          ) : null}
                        </div>
                      ))}
                      {recentReviews.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
                          {isChinese ? '还没有 review 活动。' : 'No review activity yet.'}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      {isChinese ? '评论' : 'Comments'}
                    </div>
                    <div className="mt-3 space-y-2">
                      {recentComments.map((comment) => (
                        <div
                          key={comment.id}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-200"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-100">{comment.author}</span>
                            <span className="text-[11px] text-slate-500">
                              {formatTaskTimestamp(comment.updatedAtMs ?? comment.createdAtMs, language, isChinese)}
                            </span>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-300">
                            {comment.body}
                          </div>
                          {comment.url ? (
                            <a
                              href={comment.url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--theme-accent-text)] underline-offset-4 hover:underline"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              {isChinese ? '在 GitHub 中查看' : 'Open on GitHub'}
                            </a>
                          ) : null}
                        </div>
                      ))}
                      {recentComments.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
                          {isChinese ? '还没有 comment 活动。' : 'No comment activity yet.'}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'Task events' : 'Task events'}
              </div>
              <div className="mt-3 space-y-2">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className={cn(
                      'rounded-xl border px-3 py-2 text-sm',
                      taskEventToneClass(event.tone)
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="uppercase tracking-[0.16em] text-[11px] text-white/70">
                        {event.kind}
                      </span>
                      <span className="text-[11px] text-white/60">
                        {formatRelayTime(event.createdAtMs, language)}
                      </span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words">{event.message}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? 'Agent logs' : 'Agent logs'}
                </div>
                {run ? (
                  <Badge className={runBadgeClass(run.status)}>{run.status}</Badge>
                ) : null}
              </div>
              <div
                ref={logViewportRef}
                className="mt-3 max-h-[420px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-3 font-mono text-xs leading-5"
              >
                {logs.length === 0 ? (
                  <div className="text-slate-500">
                    {isChinese ? '任务运行后这里会显示 agent stdout/stderr。' : 'Agent stdout/stderr will appear here once the task run starts.'}
                  </div>
                ) : (
                  logs.map((entry) => (
                    <div key={entry.id} className={cn('whitespace-pre-wrap break-words', logClass(entry.stream))}>
                      {entry.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
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
  movingInterventionId,
  pinningInterventionId,
  removingInterventionId,
  onInterventionDraftChange,
  onCancelInterventionEdit,
  onEditIntervention,
  onMoveIntervention,
  onToggleInterventionPin,
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
  movingInterventionId: string | null;
  pinningInterventionId: string | null;
  removingInterventionId: string | null;
  onInterventionDraftChange: (value: string) => void;
  onCancelInterventionEdit: () => void;
  onEditIntervention: (intervention: AgentRelayInterventionDTO) => void;
  onMoveIntervention: (interventionId: string, direction: 'up' | 'down') => void;
  onToggleInterventionPin: (interventionId: string, pinned: boolean) => void;
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
  const pinnedRules = useMemo(
    () => interventions.filter((entry) => entry.pinned).sort(comparePinnedRules),
    [interventions]
  );
  const recentInterventions = useMemo(
    () => [...interventions].sort((left, right) => right.createdAtMs - left.createdAtMs).slice(0, 4),
    [interventions]
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
                      const success = await copyTextWithFeedback(relay.summary ?? '', {
                        successMessage: isChinese ? '房间摘要已复制' : 'Room summary copied',
                        errorMessage: isChinese ? '复制房间摘要失败' : 'Failed to copy room summary',
                      });
                      if (!success) return;
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
                      {entry.pinned ? (
                        <Badge className="border-violet-400/30 bg-violet-400/10 text-violet-100">
                          {isChinese ? '长期规则' : 'Pinned rule'}
                        </Badge>
                      ) : null}
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
        {pinnedRules.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {isChinese ? '长期规则' : 'Pinned rules'}
            </div>
            {pinnedRules.map((entry, index) => (
              <div
                key={entry.id}
                className="rounded-xl border border-violet-400/20 bg-violet-400/[0.06] px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-violet-200/80">
                    <Pin className="h-3 w-3" />
                    {isChinese ? `规则 ${index + 1}` : `Rule ${index + 1}`}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onMoveIntervention(entry.id, 'up')}
                      disabled={
                        index === 0 ||
                        isMovingIntervention === entry.id ||
                        pinningInterventionId === entry.id
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-violet-300/20 px-2 py-1 text-[11px] text-violet-100 transition hover:bg-violet-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArrowUp className="h-3 w-3" />
                      {isChinese ? '上移' : 'Up'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveIntervention(entry.id, 'down')}
                      disabled={
                        index === pinnedRules.length - 1 ||
                        isMovingIntervention === entry.id ||
                        pinningInterventionId === entry.id
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-violet-300/20 px-2 py-1 text-[11px] text-violet-100 transition hover:bg-violet-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArrowDown className="h-3 w-3" />
                      {isChinese ? '下移' : 'Down'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleInterventionPin(entry.id, false)}
                      disabled={pinningInterventionId === entry.id}
                      className="inline-flex items-center gap-1 rounded-full border border-violet-300/20 px-2 py-1 text-[11px] text-violet-100 transition hover:bg-violet-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pinningInterventionId === entry.id ? (
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                      ) : (
                        <Pin className="h-3 w-3" />
                      )}
                      {isChinese ? '取消置顶' : 'Unpin'}
                    </button>
                  </div>
                </div>
                <div className="mt-1 whitespace-pre-wrap break-words text-sm text-violet-50">
                  {entry.content}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {recentInterventions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {recentInterventions.map((entry) => (
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
                        disabled={
                          isSendingIntervention ||
                          removingInterventionId === entry.id ||
                          movingInterventionId === entry.id
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Pencil className="h-3 w-3" />
                        {isChinese ? '编辑' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleInterventionPin(entry.id, !entry.pinned)}
                        disabled={
                          pinningInterventionId === entry.id ||
                          removingInterventionId === entry.id
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-violet-300/20 px-2 py-1 text-[11px] text-violet-100 transition hover:bg-violet-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {pinningInterventionId === entry.id ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <Pin className="h-3 w-3" />
                        )}
                        {entry.pinned
                          ? isChinese
                            ? '取消置顶'
                            : 'Unpin'
                          : isChinese
                            ? '置顶为规则'
                            : 'Pin rule'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveIntervention(entry.id)}
                        disabled={
                          isSendingIntervention ||
                          removingInterventionId === entry.id ||
                          pinningInterventionId === entry.id
                        }
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
                  {entry.pinned ? (
                    <div className="mt-1 text-[11px] text-violet-100">
                      {isChinese ? '已置顶为长期规则' : 'Pinned as a long-running room rule'}
                    </div>
                  ) : null}
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
  const [isRecentPromptsOpen, setIsRecentPromptsOpen] = useState(false);
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
        <button
          type="button"
          onClick={() => setIsRecentPromptsOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-left transition hover:bg-white/[0.04]"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
              <Command className="h-3.5 w-3.5" />
              {isChinese ? '历史快捷提问' : 'Recent prompts'}
            </div>
            <div className="mt-2 text-sm text-slate-300">
              {isRecentPromptsOpen
                ? isChinese
                  ? '点击收起历史提问和发送说明。'
                  : 'Click to collapse recent prompts and delivery guidance.'
                : hasRecentPrompts
                  ? isChinese
                    ? '点击展开最近提问，快速重新带回输入框。'
                    : 'Click to expand recent prompts and refill the composer quickly.'
                  : isChinese
                    ? '当前没有历史提问，点击展开查看说明。'
                    : 'No recent prompts yet. Click to expand the helper panel.'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="muted" className="bg-white/5 text-slate-300">
              {recentPrompts.length}
            </Badge>
            {isRecentPromptsOpen ? (
              <ArrowUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ArrowDown className="h-4 w-4 text-slate-400" />
            )}
          </div>
        </button>

        {isRecentPromptsOpen ? (
          <>
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
          </>
        ) : null}
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

async function stopAgentTask(taskId: string) {
  await fetch(`/api/tasks/${encodeURIComponent(taskId)}/stop`, { method: 'POST' });
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

async function sendTerminalInput(
  terminalId: string,
  input: string,
  messages = {
    timeoutMessage: 'Sending the message to the terminal timed out.',
    errorMessage: 'Failed to send message to terminal.',
  }
) {
  if (!input) return;
  const { response, data } = await requestJson<{ error?: string }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/input`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    },
    messages.timeoutMessage
  );
  if (!response.ok) {
    throw new Error(data?.error ?? messages.errorMessage);
  }
}

function normalizeChatInput(value: string) {
  return `${value.replace(/\r?\n/g, '\r')}\r`;
}

async function requestJson<T>(
  input: string,
  init: RequestInit,
  timeoutMessage: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<{ response: Response; data: T | null }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as T | null;
    return { response, data };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function orderRelayParticipants(
  participants: AgentRelayParticipantInputDTO[],
  starter: SessionDTO['provider']
) {
  const firstIndex = participants.findIndex((participant) => participant.provider === starter);
  if (firstIndex <= 0) return participants;
  return [...participants.slice(firstIndex), ...participants.slice(0, firstIndex)];
}

function relayTemplateLabel(templateId: RelayTemplateId, isChinese: boolean) {
  if (!isBuiltinRelayTemplateId(templateId)) {
    return isChinese ? '自定义模板' : 'Custom template';
  }
  if (templateId === 'review-trio') {
    return isChinese ? '评审三人组' : 'Review trio';
  }
  if (templateId === 'delivery-room') {
    return isChinese ? '交付房间' : 'Delivery room';
  }
  return isChinese ? '经典对谈' : 'Classic duel';
}

function resolveRelayTemplate(
  templateId: RelayTemplateId,
  starter: SessionDTO['provider'],
  isChinese: boolean,
  customTemplates: CustomRelayTemplateRecord[]
): RelayTemplateDefinition {
  const customTemplate = customTemplates.find((entry) => entry.id === templateId);
  if (customTemplate) {
    return {
      ...customTemplate,
      id: customTemplate.id,
      name: customTemplate.name,
      custom: true,
    };
  }

  const builtIn = buildRelayTemplate(templateId, starter, isChinese);
  return {
    ...builtIn,
    id: templateId,
    name: relayTemplateLabel(templateId, isChinese),
  };
}

function buildRelayTemplate(
  templateId: RelayTemplateId,
  starter: SessionDTO['provider'],
  isChinese: boolean
): {
  participants: AgentRelayParticipantInputDTO[];
  description: string;
  defaultPinnedRules: string[];
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
      defaultPinnedRules: isChinese
        ? [
            '先统一问题定义，再拆成可以验证的小结论。',
            '每一轮都指出一个风险或盲点，不要只重复赞同。',
            '建议尽量落到可执行的下一步，而不是停在抽象意见。',
          ]
        : [
            'Align on the problem definition before splitting into testable conclusions.',
            'In every turn, surface at least one risk or blind spot instead of only agreeing.',
            'Push recommendations toward actionable next steps instead of abstract opinions.',
          ],
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
      defaultPinnedRules: isChinese
        ? [
            '优先推进到可交付结果，避免无止境讨论。',
            '发现阻塞时，先给出绕行方案，再讨论理想解。',
            '在结束前明确产出物、风险和推荐决策。',
          ]
        : [
            'Bias toward a shippable outcome instead of endless discussion.',
            'When blocked, propose a workable path before debating the ideal solution.',
            'Before ending, make the deliverable, risks, and recommended decision explicit.',
          ],
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
    defaultPinnedRules: isChinese
      ? [
          '保持短回合，但每轮都要推进讨论而不是重复前文。',
          '如果意见不同，先明确分歧点，再尝试收敛。',
        ]
      : [
          'Keep turns short, but make sure every turn advances the discussion instead of repeating it.',
          'If you disagree, name the exact point of disagreement before trying to converge.',
        ],
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
        `### ${entry.pinned ? 'Pinned rule' : 'Human steer'} · ${new Date(entry.createdAtMs).toLocaleString()}`,
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

function formatTaskTimestamp(
  createdAtMs: number | undefined,
  language: string,
  isChinese: boolean
) {
  if (!createdAtMs) {
    return isChinese ? '时间未知' : 'Unknown time';
  }
  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(createdAtMs);
}

function comparePinnedRules(
  left: AgentRelayInterventionDTO,
  right: AgentRelayInterventionDTO
) {
  return (
    (left.sortOrder ?? left.createdAtMs) - (right.sortOrder ?? right.createdAtMs) ||
    left.createdAtMs - right.createdAtMs
  );
}

function parsePinnedRulesDraft(value: string) {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8);
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

function taskBadgeClass(status: AgentTaskDTO['status']) {
  if (status === 'ready') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  if (status === 'merged') return 'border-sky-400/30 bg-sky-400/10 text-sky-100';
  if (status === 'preparing' || status === 'running') {
    return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  }
  if (status === 'stopped') return 'border-white/15 bg-white/[0.06] text-slate-200';
  return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
}

function taskTestBadgeClass(status: AgentTaskDTO['testResult']['status']) {
  if (status === 'passed') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  if (status === 'running') return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  if (status === 'idle' || status === 'skipped') {
    return 'border-white/15 bg-white/[0.06] text-slate-200';
  }
  return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
}

function githubReviewBadgeClass(state: string) {
  const normalized = state.toUpperCase();
  if (normalized === 'APPROVED') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  if (normalized === 'CHANGES_REQUESTED') return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
  if (normalized === 'COMMENTED') return 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100';
  return 'border-white/15 bg-white/[0.06] text-slate-200';
}

function githubCheckBadgeClass(status: string, conclusion?: string) {
  if (status !== 'completed' || conclusion === 'pending') {
    return 'border-amber-400/30 bg-amber-400/10 text-amber-100';
  }
  if (conclusion && ['success', 'neutral', 'skipped'].includes(conclusion)) {
    return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  }
  if (conclusion) {
    return 'border-rose-400/30 bg-rose-400/10 text-rose-100';
  }
  return 'border-white/15 bg-white/[0.06] text-slate-200';
}

function githubCheckSortOrder(check: AgentTaskDTO['checks'][number]) {
  if (check.status === 'completed' && check.conclusion && !['success', 'neutral', 'skipped'].includes(check.conclusion)) {
    return 0;
  }
  if (check.status !== 'completed' || check.conclusion === 'pending') {
    return 1;
  }
  return 2;
}

function taskEventToneClass(tone: AgentTaskEventDTO['tone']) {
  if (tone === 'success') return 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-50';
  if (tone === 'error') return 'border-rose-400/20 bg-rose-400/[0.08] text-rose-50';
  return 'border-white/10 bg-white/[0.03] text-slate-200';
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

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 break-all text-sm text-slate-100">{value}</div>
    </div>
  );
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
      relayPinnedRulesDraft:
        typeof parsed.relayPinnedRulesDraft === 'string' ? parsed.relayPinnedRulesDraft : '',
      relaySystemPrompt:
        typeof parsed.relaySystemPrompt === 'string' ? parsed.relaySystemPrompt : '',
      relayStarter: parsed.relayStarter === 'claude' ? 'claude' : 'codex',
      relayTemplateId:
        typeof parsed.relayTemplateId === 'string' ? parsed.relayTemplateId : 'duel',
      relayMaxTurns:
        typeof parsed.relayMaxTurns === 'number' && Number.isFinite(parsed.relayMaxTurns)
          ? Math.min(12, Math.max(2, Math.round(parsed.relayMaxTurns)))
          : 4,
      selectedTaskId: typeof parsed.selectedTaskId === 'string' ? parsed.selectedTaskId : null,
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
  return value === 'task' || value === 'run' || value === 'terminal' || value === 'relay';
}

function isBuiltinRelayTemplateId(value: RelayTemplateId) {
  return BUILTIN_RELAY_TEMPLATE_IDS.includes(value as (typeof BUILTIN_RELAY_TEMPLATE_IDS)[number]);
}

function readCustomRelayTemplates(): CustomRelayTemplateRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_RELAY_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is CustomRelayTemplateRecord => {
        if (!entry || typeof entry !== 'object') return false;
        const candidate = entry as Partial<CustomRelayTemplateRecord>;
        return (
          typeof candidate.id === 'string' &&
          typeof candidate.name === 'string' &&
          Array.isArray(candidate.participants) &&
          typeof candidate.description === 'string' &&
          Array.isArray(candidate.defaultPinnedRules) &&
          (candidate.starter === 'claude' || candidate.starter === 'codex') &&
          typeof candidate.maxTurns === 'number'
        );
      })
      .slice(0, 12);
  } catch {
    return [];
  }
}

function writeCustomRelayTemplates(templates: CustomRelayTemplateRecord[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CUSTOM_RELAY_TEMPLATES_STORAGE_KEY,
      JSON.stringify(templates)
    );
  } catch {
    // Ignore storage failures and keep the workspace usable.
  }
}
