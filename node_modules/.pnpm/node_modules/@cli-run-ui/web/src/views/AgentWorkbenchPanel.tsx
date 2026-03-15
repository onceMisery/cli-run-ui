import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { RefObject } from 'react';
import type {
  AgentRelayParticipantInputDTO,
  AgentRelayInterventionDTO,
  AgentRelaySessionDTO,
  AgentRelayTurnDTO,
  AgentTaskDTO,
  AgentTaskEventDTO,
  ImportedGitHubIssueDraftDTO,
  RunLogEntryDTO,
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
  CheckCircle2,
  Clock3 as Clock3Icon,
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
import { useCliHealth } from '@/hooks/useCliHealth';
import type { StreamStatus } from '@/hooks/useSessionStream';
import { useRunStream } from '@/hooks/useRunStream';
import { useTaskStream } from '@/hooks/useTaskStream';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiFetch, useApiConfig } from '@/lib/api';
import { copyTextWithFeedback } from '@/lib/copy-feedback';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type LaunchSurface = 'task' | 'run' | 'terminal' | 'relay';
type WorkbenchUiMode = 'guided' | 'advanced';
export type AgentWorkbenchPage =
  | 'chat'
  | 'launch'
  | 'task'
  | 'run'
  | 'terminal'
  | 'relay'
  | 'history';
type WorkbenchPage = AgentWorkbenchPage;

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
  activePage?: WorkbenchPage;
  onPageChange?: (page: WorkbenchPage) => void;
  hidePageTabs?: boolean;
}

interface WorkbenchPreferences {
  uiMode: WorkbenchUiMode;
  showAdvancedControls: boolean;
  page: WorkbenchPage;
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
  activePage,
  onPageChange,
  hidePageTabs = false,
}: AgentWorkbenchPanelProps) {
  const { isChinese } = useI18n();
  const { config: apiConfig } = useApiConfig();
  const isReadOnly = apiConfig.readOnly;
  const {
    health: cliHealth,
    loading: cliHealthLoading,
    error: cliHealthError,
    refresh: refreshCliHealth,
  } = useCliHealth();
  const savedPreferences = useMemo(readWorkbenchPreferences, []);
  const [uiMode, setUiMode] = useState<WorkbenchUiMode>(savedPreferences?.uiMode ?? 'guided');
  const [showAdvancedControls, setShowAdvancedControls] = useState(
    savedPreferences?.showAdvancedControls ?? false
  );
  const [pageState, setPageState] = useState<WorkbenchPage>(savedPreferences?.page ?? 'chat');
  const page = activePage ?? pageState;
  const setPage = (nextPage: WorkbenchPage) => {
    if (activePage !== undefined) {
      if (onPageChange) {
        onPageChange(nextPage);
        return;
      }
      setPageState(nextPage);
      return;
    }
    setPageState(nextPage);
  };
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
  const chatComposerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!activeSession) return;
    setProvider(activeSession.provider);
    setMode('resume');
    if (activeSession.projectPath) {
      setCwd(activeSession.projectPath);
    }
  }, [activeSession?.projectPath, activeSession?.provider, activeSession?.uid]);

  useEffect(() => {
    if (uiMode === 'advanced' && !showAdvancedControls) {
      setShowAdvancedControls(true);
    }
  }, [showAdvancedControls, uiMode]);

  useEffect(() => {
    writeWorkbenchPreferences({
      uiMode,
      showAdvancedControls,
      page,
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
    uiMode,
    showAdvancedControls,
    page,
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
    !isReadOnly &&
    !isLaunchingRun &&
    cwd.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (mode === 'task' || canResume);
  const canLaunchTask =
    !isReadOnly &&
    !isLaunchingTask &&
    cwd.trim().length > 0 &&
    prompt.trim().length > 0 &&
    (mode === 'task' || canResume);
  const canLaunchTerminal =
    !isReadOnly &&
    !isLaunchingTerminal &&
    cwd.trim().length > 0 &&
    (mode === 'task' || canResume);
  const canSendChat =
    !isReadOnly &&
    !isSendingChat &&
    chatDraft.trim().length > 0 &&
    cwd.trim().length > 0 &&
    (mode === 'task' || canResume);
  const canLaunchRelay =
    !isReadOnly &&
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
  const cliChecks = cliHealth?.checks ?? [];
  const activeSurface: LaunchSurface =
    page === 'task' || page === 'run' || page === 'terminal' || page === 'relay'
      ? page
      : surface;
  const pageShowsControlRail = page === 'launch' || page === 'history';
  const pageShowsMainPane =
    page === 'chat' ||
    page === 'task' ||
    page === 'run' ||
    page === 'terminal' ||
    page === 'relay';
  const showSurfaceOverview = page === 'task' || page === 'run' || page === 'terminal';
  const layoutColumnsClass =
    pageShowsControlRail && pageShowsMainPane
      ? 'xl:grid-cols-[minmax(0,1fr)_360px]'
      : 'xl:grid-cols-1';
  const selectedProviderCheck = cliChecks.find((entry) => entry.provider === provider) ?? null;
  const isProviderReady = selectedProviderCheck?.status === 'ready';
  const hasWorkspace = cwd.trim().length > 0;
  const hasAnyPrompt =
    chatDraft.trim().length > 0 || prompt.trim().length > 0 || relayPrompt.trim().length > 0;
  const guideStepsCompleted = Number(isProviderReady) + Number(hasWorkspace) + Number(hasAnyPrompt);
  const guideProgressLabel = isChinese
    ? `已完成 ${guideStepsCompleted}/3 步`
    : `${guideStepsCompleted}/3 steps complete`;
  const readOnlyNotice = isChinese
    ? '当前处于只读模式，已禁用写操作。'
    : 'Read-only mode is enabled. Write actions are disabled.';
  const hasAnyActivity = tasks.length + runs.length + terminals.length + relays.length > 0;
  const surfaceMeta = useMemo(() => {
    if (activeSurface === 'task') {
      return {
        title: isChinese ? '任务闭环' : 'Task loop',
        description: isChinese
          ? '从任务、分支、测试到 PR 的交付回路。'
          : 'A delivery loop from branch creation to tests and PR.',
        count: tasks.length,
        focus: liveTask?.title ?? (isChinese ? '选择一个任务或新建一个 task loop。' : 'Pick a task or start a new task loop.'),
      };
    }

    if (activeSurface === 'run') {
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

    if (activeSurface === 'terminal') {
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
  }, [activeSurface, isChinese, liveRelay?.title, liveRun?.command, liveTask?.title, liveTerminal?.command, relays.length, runs.length, tasks.length, terminals.length]);

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
    if (isReadOnly) {
      setTaskError(readOnlyNotice);
      return;
    }
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
        setPage('task');
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
    if (isReadOnly) {
      setTaskError(readOnlyNotice);
      return;
    }
    if (!taskIssueUrl.trim() || isImportingTaskIssue) return;
    setIsImportingTaskIssue(true);
    setTaskError(null);

    try {
      const response = await apiFetch('/api/tasks/import-issue', {
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
    if (isReadOnly) {
      setTaskError(readOnlyNotice);
      return;
    }
    if (!liveTask || isRefreshingTask) return;
    setIsRefreshingTask(true);
    setTaskError(null);
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(liveTask.id)}/refresh`, {
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
    if (isReadOnly) {
      setTaskError(readOnlyNotice);
      return;
    }
    if (!liveTask || isCreatingTaskPr) return;
    setIsCreatingTaskPr(true);
    setTaskError(null);
    try {
      const response = await apiFetch(
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
    if (isReadOnly) {
      setTaskError(readOnlyNotice);
      return;
    }
    if (!liveTask?.pullRequest || isReviewingTaskPr) return;
    setIsReviewingTaskPr(true);
    setTaskError(null);
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(liveTask.id)}/review`, {
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
    if (isReadOnly) {
      setTaskError(readOnlyNotice);
      return;
    }
    if (!liveTask?.pullRequest || isMergingTaskPr) return;
    setIsMergingTaskPr(true);
    setTaskError(null);
    try {
      const response = await apiFetch(`/api/tasks/${encodeURIComponent(liveTask.id)}/merge`, {
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
    if (isReadOnly) {
      setRunError(readOnlyNotice);
      return;
    }
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
        setPage('run');
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
    if (isReadOnly) {
      setTerminalError(readOnlyNotice);
      throw new Error(readOnlyNotice);
    }
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
    if (isReadOnly) {
      setTerminalError(readOnlyNotice);
      return;
    }
    if (!canLaunchTerminal) return;
    setIsLaunchingTerminal(true);
    setTerminalError(null);
    try {
      await startTerminalSession(prompt.trim() || undefined);
      setPage('terminal');
    } catch (reason) {
      setTerminalError(reason instanceof Error ? reason.message : 'Failed to open terminal.');
    } finally {
      setIsLaunchingTerminal(false);
    }
  };

  const sendChatMessage = async () => {
    if (isReadOnly) {
      setChatError(readOnlyNotice);
      return;
    }
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
    if (isReadOnly) {
      setRelayError(readOnlyNotice);
      return;
    }
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
        setPage('relay');
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
    if (isReadOnly) {
      setRelayInterventionError(readOnlyNotice);
      return;
    }
    if (!liveRelay || !relayInterventionDraft.trim() || isSendingRelayIntervention) return;
    setIsSendingRelayIntervention(true);
    setRelayInterventionError(null);

    try {
      const response = editingRelayInterventionId
        ? await apiFetch(
            `/api/relays/${encodeURIComponent(liveRelay.id)}/interventions/${encodeURIComponent(editingRelayInterventionId)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: relayInterventionDraft.trim() }),
            }
          )
        : await apiFetch(`/api/relays/${encodeURIComponent(liveRelay.id)}/interventions`, {
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
    if (isReadOnly) {
      setRelayInterventionError(readOnlyNotice);
      return;
    }
    if (!liveRelay || isRemovingRelayIntervention) return;
    setIsRemovingRelayIntervention(interventionId);
    setRelayInterventionError(null);

    try {
      const response = await apiFetch(
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
    if (isReadOnly) {
      setRelayInterventionError(readOnlyNotice);
      return;
    }
    if (!liveRelay || isPinningRelayIntervention) return;
    setIsPinningRelayIntervention(interventionId);
    setRelayInterventionError(null);

    try {
      const response = await apiFetch(
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
    if (isReadOnly) {
      setRelayInterventionError(readOnlyNotice);
      return;
    }
    if (!liveRelay || isMovingRelayIntervention) return;
    setIsMovingRelayIntervention(interventionId);
    setRelayInterventionError(null);

    try {
      const response = await apiFetch(
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
    if (isReadOnly) {
      setRelayError(readOnlyNotice);
      return;
    }
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
    if (isReadOnly) {
      setRelayError(readOnlyNotice);
      return;
    }
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
    setUiMode('guided');
    setShowAdvancedControls(false);
    setPage('chat');
    setCwd(activeSession?.projectPath ?? '');
    setSurface('run');
  };

  const handleStopRun = async (runId: string) => {
    if (isReadOnly) {
      setRunError(readOnlyNotice);
      return;
    }
    await stopRun(runId);
  };

  const handleStopTask = async (taskId: string) => {
    if (isReadOnly) {
      setTaskError(readOnlyNotice);
      return;
    }
    await stopAgentTask(taskId);
  };

  const handleStopTerminal = async (terminalId: string) => {
    if (isReadOnly) {
      setTerminalError(readOnlyNotice);
      return;
    }
    await stopTerminal(terminalId);
  };

  const handleStopRelay = async (relayId: string) => {
    if (isReadOnly) {
      setRelayError(readOnlyNotice);
      return;
    }
    await stopRelay(relayId);
  };

  const switchToGuidedMode = () => {
    setUiMode('guided');
    setShowAdvancedControls(false);
  };

  const switchToAdvancedMode = () => {
    setUiMode('advanced');
    setShowAdvancedControls(true);
  };

  const openPage = (nextPage: WorkbenchPage) => {
    setPage(nextPage);
    if (nextPage === 'launch' || nextPage === 'relay' || nextPage === 'history') {
      setShowAdvancedControls(true);
    }
    if (
      nextPage === 'task' ||
      nextPage === 'run' ||
      nextPage === 'terminal' ||
      nextPage === 'relay'
    ) {
      setSurface(nextPage);
    }
  };

  const focusBrowserChatComposer = () => {
    openPage('chat');
    setSurface('terminal');
    window.setTimeout(() => {
      chatComposerRef.current?.focus();
    }, 30);
  };

  const fillStarterPrompt = () => {
    const starterPrompt = isChinese
      ? '请先阅读当前仓库结构，然后给我一个三步执行计划并开始第一步。'
      : 'Read this repository first, then give me a 3-step plan and start step 1.';
    setChatDraft(starterPrompt);
    focusBrowserChatComposer();
  };

  return (
    <section className="agent-workbench theme-panel rounded-[30px] p-4">
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={switchToGuidedMode}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition',
              uiMode === 'guided'
                ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
                : 'border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] text-slate-400 hover:text-slate-200'
            )}
          >
            {isChinese ? '引导模式' : 'Guided'}
          </button>
          <button
            type="button"
            onClick={switchToAdvancedMode}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition',
              uiMode === 'advanced'
                ? 'border-[var(--theme-secondary-border)] bg-[var(--theme-secondary-soft)] text-[var(--theme-secondary-text)]'
                : 'border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] text-slate-400 hover:text-slate-200'
            )}
          >
            {isChinese ? '高级模式' : 'Advanced'}
          </button>
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

      {uiMode === 'guided' ? (
        <section className={`${WORKBENCH_PANEL_STRONG_CLASS} mt-4 border-[var(--theme-accent-border)]`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '快速上手（推荐）' : 'Quick start (recommended)'}
              </div>
              <div className="mt-1 text-sm text-slate-200">
                {isChinese
                  ? '先完成 3 步，再在右侧「浏览器对话」里直接输入需求并发送。'
                  : 'Finish these 3 steps, then use Browser chat on the right to send your request.'}
              </div>
            </div>
            <Badge variant="muted" className="bg-white/5 text-slate-300">
              {guideProgressLabel}
            </Badge>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            <GuideStepCard
              done={isProviderReady}
              title={isChinese ? '1. 检查 Agent CLI' : '1. Check agent CLI'}
              description={
                selectedProviderCheck
                  ? selectedProviderCheck.status === 'ready'
                    ? isChinese
                      ? `${provider} 已可用：${selectedProviderCheck.command}`
                      : `${provider} is ready: ${selectedProviderCheck.command}`
                    : selectedProviderCheck.message ??
                      (isChinese ? '命令不可用，请先检查环境。' : 'CLI command is unavailable.')
                  : isChinese
                    ? '等待环境检测结果...'
                    : 'Waiting for health check results...'
              }
            />
            <GuideStepCard
              done={hasWorkspace}
              title={isChinese ? '2. 填写工作区' : '2. Set workspace path'}
              description={
                hasWorkspace
                  ? cwd
                  : isChinese
                    ? '请填写本地仓库绝对路径（例如 D:\\code\\cli-run-ui）。'
                    : 'Add the absolute local repo path (for example D:\\code\\cli-run-ui).'
              }
            />
            <GuideStepCard
              done={hasAnyPrompt}
              title={isChinese ? '3. 准备提示词' : '3. Prepare your prompt'}
              description={
                hasAnyPrompt
                  ? isChinese
                    ? '已准备提示词，可以发送。'
                    : 'Prompt is ready to send.'
                  : isChinese
                    ? '你可以先使用「填入示例」快速开始。'
                    : 'Use “Fill starter prompt” to begin quickly.'
              }
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={focusBrowserChatComposer}
              className="rounded-xl bg-[var(--theme-accent-solid)] text-[var(--theme-accent-foreground)] hover:bg-[var(--theme-accent-solid-hover)]"
            >
              <MessageSquare className="h-4 w-4" />
              {isChinese ? '去浏览器对话（推荐）' : 'Go to browser chat'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={fillStarterPrompt}
              className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
            >
              <Sparkles className="h-4 w-4" />
              {isChinese ? '填入示例提示词' : 'Fill starter prompt'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAdvancedControls((current) => !current)}
              className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
            >
              <SplitSquareVertical className="h-4 w-4" />
              {showAdvancedControls
                ? isChinese
                  ? '收起高级控制'
                  : 'Hide advanced controls'
                : isChinese
                  ? '展开高级控制'
                  : 'Show advanced controls'}
            </Button>
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {hasAnyActivity
              ? isChinese
                ? '你已经有历史运行记录，可在下方 Current surface 中继续查看或接管。'
                : 'You already have activity history. Continue from Current surface below.'
              : isChinese
                ? '首次使用建议：先用浏览器对话发一句“先阅读仓库并给出三步计划”。'
                : 'First-time tip: send “read the repo and propose a 3-step plan” in Browser chat.'}
          </div>
        </section>
      ) : null}

      {!hidePageTabs ? (
      <section className={`${WORKBENCH_PANEL_CLASS} mt-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <WorkbenchPageChip
            active={page === 'chat'}
            onClick={() => openPage('chat')}
            label={isChinese ? '聊天' : 'Chat'}
            icon={MessageSquare}
          />
          <WorkbenchPageChip
            active={page === 'launch'}
            onClick={() => openPage('launch')}
            label={isChinese ? '启动' : 'Launch'}
            icon={Play}
          />
          <WorkbenchPageChip
            active={page === 'task'}
            onClick={() => openPage('task')}
            label="Task"
            icon={GitBranch}
          />
          <WorkbenchPageChip
            active={page === 'run'}
            onClick={() => openPage('run')}
            label="Run"
            icon={Monitor}
          />
          <WorkbenchPageChip
            active={page === 'terminal'}
            onClick={() => openPage('terminal')}
            label={isChinese ? '终端' : 'Terminal'}
            icon={SquareTerminal}
          />
          <WorkbenchPageChip
            active={page === 'relay'}
            onClick={() => openPage('relay')}
            label="Relay"
            icon={SplitSquareVertical}
          />
          <WorkbenchPageChip
            active={page === 'history'}
            onClick={() => openPage('history')}
            label={isChinese ? '历史' : 'History'}
            icon={Clock3Icon}
          />
        </div>
      </section>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <WorkbenchMiniMetric
          label={isChinese ? '任务闭环' : 'Task loops'}
          value={String(tasks.length)}
          helper={isChinese ? '分支、测试、PR 一条线' : 'branch, tests, and PR in one flow'}
          icon={GitBranch}
        />
        <WorkbenchMiniMetric
          label={isChinese ? '无头运行' : 'Headless runs'}
          value={String(runs.length)}
          helper={isChinese ? '适合一次性后台执行' : 'best for one-shot background work'}
          icon={Play}
        />
        <WorkbenchMiniMetric
          label={isChinese ? '交互终端' : 'Interactive terminals'}
          value={String(terminals.length)}
          helper={isChinese ? '保留上下文继续协作' : 'keep context alive for follow-ups'}
          icon={Monitor}
        />
        <WorkbenchMiniMetric
          label={isChinese ? 'Agent 房间' : 'Agent rooms'}
          value={String(relays.length)}
          helper={isChinese ? '多智能体协作与人工介入' : 'multi-agent rooms with human steering'}
          icon={SplitSquareVertical}
        />
      </div>

      <div className={cn('mt-4 grid gap-4', layoutColumnsClass)}>
        {pageShowsControlRail ? (
        <div className="space-y-4 xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto xl:pr-1">
          {uiMode === 'guided' && !showAdvancedControls ? (
            <section className={WORKBENCH_PANEL_CLASS}>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '高级控制已收起' : 'Advanced controls are hidden'}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {isChinese
                  ? '当前使用引导模式。推荐先在右侧「浏览器对话」输入需求并发送，复杂操作再展开高级控制。'
                  : 'You are in guided mode. Start from Browser chat on the right, and expand advanced controls when needed.'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setShowAdvancedControls(true)}
                  className="rounded-xl bg-[var(--theme-secondary-solid)] text-[var(--theme-secondary-foreground)] hover:bg-[var(--theme-secondary-solid-hover)]"
                >
                  <SplitSquareVertical className="h-4 w-4" />
                  {isChinese ? '展开高级控制' : 'Show advanced controls'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={switchToAdvancedMode}
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                >
                  <Sparkles className="h-4 w-4" />
                  {isChinese ? '切换到高级模式' : 'Switch to advanced mode'}
                </Button>
              </div>
            </section>
          ) : (
            <>
          {page === 'launch' ? (
          <section className={WORKBENCH_PANEL_CLASS}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '启动' : 'Launch'}
              </div>
              <button
                onClick={resetDraft}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-2.5 py-1 text-[11px] text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
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

            <div className={`${WORKBENCH_PANEL_MUTED_CLASS} mt-4`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {isChinese ? '环境自检' : 'Environment check'}
                </div>
                <button
                  type="button"
                  onClick={() => void refreshCliHealth()}
                  disabled={cliHealthLoading}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-2 py-1 text-[11px] text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={cn('h-3 w-3', cliHealthLoading && 'animate-spin')} />
                  {isChinese ? '刷新' : 'Refresh'}
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {cliChecks.map((check) => (
                  <div
                    key={`cli-check-${check.provider}`}
                    className="rounded-xl border border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">{check.provider}</span>
                      <Badge className={cliCheckBadgeClass(check.status)}>
                        {check.status === 'ready'
                          ? isChinese
                            ? '可用'
                            : 'ready'
                          : check.status === 'missing'
                            ? isChinese
                              ? '缺失'
                              : 'missing'
                            : isChinese
                              ? '异常'
                              : 'error'}
                      </Badge>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-slate-400">{check.command}</div>
                    {check.version ? (
                      <div className="mt-1 text-xs text-slate-300">{check.version}</div>
                    ) : null}
                    {check.message ? (
                      <div className="mt-1 text-xs text-amber-100/90">{check.message}</div>
                    ) : null}
                  </div>
                ))}

                {!cliHealthLoading && cliChecks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-3 py-3 text-xs text-slate-400">
                    {isChinese ? '暂无检测结果。' : 'No CLI checks available yet.'}
                  </div>
                ) : null}
              </div>

              <div className="mt-2 text-[11px] text-slate-400">
                {isChinese
                  ? '可通过 CLI_RUN_UI_CODEX_COMMAND / CLI_RUN_UI_CLAUDE_COMMAND 指定命令路径。'
                  : 'Use CLI_RUN_UI_CODEX_COMMAND / CLI_RUN_UI_CLAUDE_COMMAND to override executable paths.'}
              </div>
              {cliHealthError ? (
                <InlineNotice tone="error">
                  {(isChinese ? '自检失败：' : 'Health check failed: ') + cliHealthError}
                </InlineNotice>
              ) : null}
            </div>

            <label className="mt-3 block">
              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '工作区' : 'Workspace'}
              </div>
              <input
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder="D:\\code\\your-project"
                className={WORKBENCH_INPUT_CLASS}
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
                className={`${WORKBENCH_INPUT_CLASS} resize-none`}
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
                  className={`${WORKBENCH_INPUT_CLASS} min-w-0 flex-1`}
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
                className={WORKBENCH_INPUT_CLASS}
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
                className={WORKBENCH_INPUT_CLASS}
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
          ) : null}

          {page === 'relay' ? (
          <section className={WORKBENCH_PANEL_CLASS}>
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

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className={WORKBENCH_PANEL_MUTED_CLASS}>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? '模板重点' : 'Template focus'}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-100">
                  {relayTemplate.focus ?? relayTemplate.description}
                </div>
              </div>
              <div className={WORKBENCH_PANEL_MUTED_CLASS}>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? '期望产出' : 'Expected output'}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-100">
                  {relayTemplate.deliverable ??
                    (isChinese
                      ? '形成一个可执行的结论、计划或 review 决策。'
                      : 'End with an actionable conclusion, plan, or review decision.')}
                </div>
              </div>
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
                className={`${WORKBENCH_INPUT_CLASS} resize-none`}
                placeholder={
                  relayTemplate.promptPlaceholder ??
                  (isChinese
                    ? '输入一个主题，让 Claude 和 Codex 围绕它轮流讨论、辩论或协作。'
                    : 'Give Claude and Codex a topic so they can alternate, debate, or collaborate.')
                }
              />
              {relayPromptIdeas.length > 0 ? (
                <div className="mt-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {isChinese ? '开场建议' : 'Suggested openers'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {relayPromptIdeas.map((idea) => (
                      <button
                        key={idea}
                        type="button"
                        onClick={() => setRelayPrompt(idea)}
                        className="rounded-full border border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-[var(--theme-accent-border)] hover:bg-[var(--theme-accent-soft)] hover:text-white"
                      >
                        {idea}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-3">
              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? 'System prompt' : 'System prompt'}
              </div>
              <textarea
                value={relaySystemPrompt}
                onChange={(event) => setRelaySystemPrompt(event.target.value)}
                rows={3}
                className={`${WORKBENCH_INPUT_CLASS} resize-none`}
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
                className={`${WORKBENCH_INPUT_CLASS} resize-none`}
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
                  className={`${WORKBENCH_INPUT_CLASS} min-w-0 flex-1`}
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
          ) : null}

          {page === 'history' ? (
          <section className={WORKBENCH_PANEL_CLASS}>
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
                    openPage('task');
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
                    openPage('run');
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
                    openPage('terminal');
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
                    openPage('relay');
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
          ) : null}
            </>
          )}
        </div>
        ) : null}

        {pageShowsMainPane ? (
        <div className="space-y-4">
          {page === 'chat' ? (
          <BrowserChatCard
            chatDraft={chatDraft}
            canSend={canSendChat}
            chatError={chatError}
            cwd={cwd}
            isReadOnly={isReadOnly}
            isSending={isSendingChat}
            mode={mode}
            canResume={canResume}
            recentPrompts={recentChatPrompts}
            terminal={liveTerminal}
            composerRef={chatComposerRef}
            onDraftChange={setChatDraft}
            onPickRecentPrompt={setChatDraft}
            onSend={() => void sendChatMessage()}
          />
          ) : null}

          {showSurfaceOverview ? (
          <>
          <section className={`${WORKBENCH_PANEL_CLASS} grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]`}>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '当前工作面' : 'Current surface'}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="text-xl font-semibold text-white">{surfaceMeta.title}</div>
                <Badge variant="muted" className="bg-white/5 text-slate-200">
                  {surfaceMeta.count}
                </Badge>
              </div>
              <div className="mt-2 text-sm text-slate-300">{surfaceMeta.description}</div>
              <div className={`${WORKBENCH_PANEL_MUTED_CLASS} mt-4`}>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? '当前焦点' : 'Current focus'}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-100">{surfaceMeta.focus}</div>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className={WORKBENCH_PANEL_MUTED_CLASS}>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {isChinese ? '执行来源' : 'Execution source'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge className={provider === 'claude' ? 'border-sky-400/30 bg-sky-400/10 text-sky-100' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'}>
                      {provider}
                    </Badge>
                    <Badge variant="muted" className="bg-white/5 text-slate-200">
                      {mode === 'resume' ? (isChinese ? '恢复模式' : 'resume') : isChinese ? '新任务模式' : 'new task'}
                    </Badge>
                  </div>
                </div>
                <div className={WORKBENCH_PANEL_MUTED_CLASS}>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {isChinese ? '绑定会话' : 'Bound session'}
                  </div>
                  <div className="mt-2 text-sm text-slate-100">
                    {activeSession
                      ? activeSession.projectName || activeSession.sessionId
                      : isChinese
                        ? '当前未绑定会话'
                        : 'No session bound yet'}
                  </div>
                </div>
              </div>
              <div className={WORKBENCH_PANEL_MUTED_CLASS}>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {isChinese ? '工作区路径' : 'Workspace path'}
                </div>
                <div className="mt-2 break-all font-mono text-xs text-slate-300">
                  {cwd || (isChinese ? '请先填写工作区路径。' : 'Add a workspace path to begin.')}
                </div>
              </div>
            </div>
          </section>

          {page === 'task' || page === 'run' || page === 'terminal' ? (
          <div className="flex gap-2">
            <SurfaceChip
              active={activeSurface === 'task'}
              onClick={() => openPage('task')}
              icon={GitBranch}
              label={isChinese ? 'Task loop' : 'Task loop'}
            />
            <SurfaceChip
              active={activeSurface === 'run'}
              onClick={() => openPage('run')}
              icon={Play}
              label={isChinese ? '无头运行' : 'Headless run'}
            />
            <SurfaceChip
              active={activeSurface === 'terminal'}
              onClick={() => openPage('terminal')}
              icon={Monitor}
              label={isChinese ? '交互式终端' : 'Interactive terminal'}
            />
          </div>
          ) : null}

          {activeSurface === 'task' ? (
            <TaskLoopPane
              task={liveTask}
              tasks={tasks}
              events={taskEvents}
              logs={taskLogs}
              run={liveTaskRun}
              isReadOnly={isReadOnly}
              isRefreshing={isRefreshingTask}
              isCreatingPullRequest={isCreatingTaskPr}
              isReviewingPullRequest={isReviewingTaskPr}
              isMergingPullRequest={isMergingTaskPr}
              taskError={taskError}
              onPick={setSelectedTaskId}
              onRefresh={(rerunTests) => void refreshTaskArtifacts(rerunTests)}
              onStop={(taskId) => void handleStopTask(taskId)}
              onCreatePullRequest={() => void createTaskPullRequest()}
              onApprove={() => void reviewTaskPullRequest('APPROVE')}
              onRequestChanges={() => void reviewTaskPullRequest('REQUEST_CHANGES')}
              onMerge={() => void mergeTaskPullRequest()}
              onExport={() =>
                liveTask
                  ? downloadTaskPackage(
                      liveTask,
                      taskLogs,
                      taskEvents,
                      liveTaskRun,
                      isChinese
                    )
                  : null
              }
            />
          ) : activeSurface === 'run' ? (
            <HeadlessRunPane
              run={liveRun}
              logs={logs}
              isReadOnly={isReadOnly}
              onPick={setSelectedRunId}
              onStop={handleStopRun}
              runs={runs}
            />
          ) : activeSurface === 'terminal' ? (
            <InteractiveTerminalPane
              terminal={liveTerminal}
              terminals={terminals}
              outputs={outputs}
              selectedTerminalId={selectedTerminalId}
              isReadOnly={isReadOnly}
              onPick={setSelectedTerminalId}
              onStop={handleStopTerminal}
            />
          ) : null}
          </>
          ) : null}

          {page === 'relay' ? (
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
              isReadOnly={isReadOnly}
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
              onStop={handleStopRelay}
            />
          ) : null}

        </div>
        ) : null}
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
  isReadOnly,
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
  onExport,
}: {
  task: AgentTaskDTO | null;
  tasks: AgentTaskDTO[];
  run: RunSessionDTO | null;
  logs: { id: string; text: string; stream: 'stdout' | 'stderr' | 'system'; timestampMs: number }[];
  events: AgentTaskEventDTO[];
  isReadOnly: boolean;
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
  onExport: () => void;
}) {
  const { isChinese, language } = useI18n();
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const readOnlyNotice = isChinese
    ? '当前处于只读模式，已禁用写操作。'
    : 'Read-only mode is enabled. Write actions are disabled.';
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
    <section className={WORKBENCH_PANEL_CLASS}>
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
              {isReadOnly ? <InlineNotice tone="warn">{readOnlyNotice}</InlineNotice> : null}
              <div className="mt-3 grid gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => onRefresh(false)}
                  disabled={isRefreshing || isReadOnly}
                >
                  {isRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isChinese ? '刷新 diff' : 'Refresh diff'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={() => onRefresh(true)}
                  disabled={isRefreshing || !task.testCommand || isReadOnly}
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
                    disabled={isReadOnly}
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
                    disabled={isCreatingPullRequest || isReadOnly}
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
                      disabled={isReviewingPullRequest || isReadOnly}
                    >
                      {isReviewingPullRequest ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      {isChinese ? 'Approve PR' : 'Approve PR'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                      onClick={onRequestChanges}
                      disabled={isReviewingPullRequest || isReadOnly}
                    >
                      <MessageSquare className="h-4 w-4" />
                      {isChinese ? 'Request changes' : 'Request changes'}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-[var(--theme-secondary-solid)] text-[var(--theme-secondary-foreground)] hover:bg-[var(--theme-secondary-solid-hover)]"
                      onClick={onMerge}
                      disabled={
                        isMergingPullRequest ||
                        Boolean(task.mergeReadiness && !task.mergeReadiness.ready) ||
                        isReadOnly
                      }
                    >
                      {isMergingPullRequest ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GitPullRequestArrow className="h-4 w-4" />}
                      {isChinese ? 'Merge PR' : 'Merge PR'}
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
                  onClick={onExport}
                  disabled={!task}
                >
                  <Download className="h-4 w-4" />
                  {isChinese ? '导出交付包' : 'Export package'}
                </Button>
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
  isReadOnly,
  onPick,
  onStop,
}: {
  run: RunSessionDTO | null;
  runs: RunSessionDTO[];
  logs: { id: string; text: string; stream: 'stdout' | 'stderr' | 'system'; timestampMs: number }[];
  isReadOnly: boolean;
  onPick: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const { isChinese } = useI18n();
  const readOnlyNotice = isChinese
    ? '当前处于只读模式，已禁用写操作。'
    : 'Read-only mode is enabled. Write actions are disabled.';
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <section className={WORKBENCH_PANEL_CLASS}>
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
            disabled={isReadOnly}
          >
            <Square className="h-4 w-4" />
            {isChinese ? '停止' : 'Stop'}
          </Button>
        ) : null}
      </div>
      {isReadOnly ? <InlineNotice tone="warn">{readOnlyNotice}</InlineNotice> : null}

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
  isReadOnly,
  onPick,
  onStop,
}: {
  terminal: TerminalSessionDTO | null;
  terminals: TerminalSessionDTO[];
  outputs: { id: string; data: string }[];
  selectedTerminalId: string | null;
  isReadOnly: boolean;
  onPick: (id: string) => void;
  onStop: (id: string) => Promise<void>;
}) {
  const { isChinese } = useI18n();
  const readOnlyNotice = isChinese
    ? '当前处于只读模式，已禁用写操作。'
    : 'Read-only mode is enabled. Write actions are disabled.';
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
          disableStdin: isReadOnly,
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
          if (isReadOnly) return;
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
          if (!selectedTerminalId || isReadOnly) return;
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
  }, [isReadOnly, selectedTerminalId]);

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
    term.setOption('disableStdin', isReadOnly);
    fit.fit();
    if (!isReadOnly) {
      void resizeTerminal(selectedTerminalId, term.cols, term.rows);
    }
  }, [isReadOnly, selectedTerminalId]);

  return (
    <section className={WORKBENCH_PANEL_CLASS}>
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
            disabled={isReadOnly}
          >
            <SquareTerminal className="h-4 w-4" />
            {isChinese ? '停止' : 'Stop'}
          </Button>
        ) : null}
      </div>
      {isReadOnly ? <InlineNotice tone="warn">{readOnlyNotice}</InlineNotice> : null}

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
    <section className={WORKBENCH_PANEL_CLASS}>
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
  isReadOnly,
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
  isReadOnly: boolean;
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
  const readOnlyNotice = isChinese
    ? '当前处于只读模式，已禁用写操作。'
    : 'Read-only mode is enabled. Write actions are disabled.';
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
                disabled={isUpdatingLifecycle || isReadOnly}
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
                disabled={isUpdatingLifecycle || isReadOnly}
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
                disabled={isReadOnly}
              >
                <Square className="h-4 w-4" />
                {isChinese ? '停止 relay' : 'Stop relay'}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {isReadOnly ? <InlineNotice tone="warn">{readOnlyNotice}</InlineNotice> : null}

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
            isSendingIntervention ||
            isReadOnly
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
              isSendingIntervention ||
              isReadOnly
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
                        movingInterventionId === entry.id ||
                        pinningInterventionId === entry.id ||
                        isReadOnly
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
                        movingInterventionId === entry.id ||
                        pinningInterventionId === entry.id ||
                        isReadOnly
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-violet-300/20 px-2 py-1 text-[11px] text-violet-100 transition hover:bg-violet-300/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ArrowDown className="h-3 w-3" />
                      {isChinese ? '下移' : 'Down'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleInterventionPin(entry.id, false)}
                      disabled={pinningInterventionId === entry.id || isReadOnly}
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
                          movingInterventionId === entry.id ||
                          isReadOnly
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
                          removingInterventionId === entry.id ||
                          isReadOnly
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
                          pinningInterventionId === entry.id ||
                          isReadOnly
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
  composerRef,
  cwd,
  isReadOnly,
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
  composerRef?: RefObject<HTMLTextAreaElement | null>;
  cwd: string;
  isReadOnly: boolean;
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
  const readOnlyNotice = isChinese
    ? '当前处于只读模式，已禁用写操作。'
    : 'Read-only mode is enabled. Write actions are disabled.';
  const disabledReason =
    isReadOnly
      ? isChinese
        ? '只读模式下无法发送消息。'
        : 'Read-only mode does not allow sending messages.'
      : cwd.trim().length === 0
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
    <section className={`${WORKBENCH_PANEL_CLASS} overflow-hidden`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            <MessageSquare className="h-3.5 w-3.5" />
            {isChinese ? '浏览器对话' : 'Browser chat'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {terminalReady
              ? isChinese
                ? '直接把消息送进当前打开的 agent 终端，适合连续协作。'
                : 'Send messages straight into the open agent terminal for continuous collaboration.'
              : isChinese
                ? '第一条消息会自动拉起终端，再把内容直接送给 agent。'
                : 'The first message auto-starts a terminal and hands the prompt to the agent.'}
          </div>
        </div>
        <Badge
          className={
            terminalReady
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
              : 'border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] text-slate-300'
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

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className={`${WORKBENCH_PANEL_STRONG_CLASS} border-[var(--theme-accent-border)]`}>
          {isReadOnly ? <InlineNotice tone="warn">{readOnlyNotice}</InlineNotice> : null}
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-3 py-2.5">
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
              {isChinese ? '输出实时回流到终端面板' : 'Output keeps streaming into the terminal pane'}
            </div>
          </div>

          <div className="mt-4 rounded-[22px] border border-[var(--theme-accent-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.24)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                {isChinese ? '消息输入' : 'Message composer'}
              </div>
              <div className="text-xs text-slate-400">
                {isChinese ? 'Ctrl/Cmd + Enter 发送' : 'Ctrl/Cmd + Enter to send'}
              </div>
            </div>
            <textarea
              ref={composerRef}
              value={chatDraft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
                event.preventDefault();
                onSend();
              }}
              rows={6}
              disabled={isSending || isReadOnly}
              className="w-full resize-none bg-transparent text-sm leading-7 text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-wait disabled:opacity-70"
              placeholder={
                isChinese
                  ? '直接输入你想让 agent 完成的事，例如实现功能、修复问题、写测试或解释代码。'
                  : 'Type what you want the agent to do: implement a feature, fix a bug, add tests, or explain code.'
              }
            />
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div className="min-w-0 text-xs text-slate-400">
                {disabledReason ??
                  (isSending
                    ? isChinese
                      ? '正在等待 agent 接收这条消息，终端与日志会继续滚动。'
                      : 'Waiting for the agent to receive your message. Terminal output and logs will keep streaming.'
                    : terminalReady
                      ? isChinese
                        ? `已连接到 ${terminal.provider} terminal，可以继续多轮对话。`
                        : `Connected to the ${terminal.provider} terminal and ready for the next turn.`
                      : isChinese
                        ? '发送后会自动起终端，并把输出展示在交互终端面板。'
                        : 'Sending will auto-start a terminal and stream the output into the interactive terminal pane.')}
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

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setIsRecentPromptsOpen((current) => !current)}
            className={`${WORKBENCH_PANEL_MUTED_CLASS} flex w-full items-center justify-between gap-3 text-left transition hover:bg-white/[0.05]`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                <Command className="h-3.5 w-3.5" />
                {isChinese ? '历史快捷提问' : 'Recent prompts'}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {isRecentPromptsOpen
                  ? isChinese
                    ? '点击收起最近提问。'
                    : 'Click to collapse recent prompts.'
                  : hasRecentPrompts
                    ? isChinese
                      ? '点击展开最近提问，一键带回输入框。'
                      : 'Click to expand your recent prompts and refill the composer.'
                    : isChinese
                      ? '当前没有历史提问，点击查看发送说明。'
                      : 'No recent prompts yet. Click to open the helper panel.'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="muted" className="bg-white/5 text-slate-300">
                {recentPrompts.length}
              </Badge>
              {isRecentPromptsOpen ? <ArrowUp className="h-4 w-4 text-slate-400" /> : <ArrowDown className="h-4 w-4 text-slate-400" />}
            </div>
          </button>

          {isRecentPromptsOpen ? (
            <div className={`${WORKBENCH_PANEL_MUTED_CLASS} space-y-3`}>
              {hasRecentPrompts ? (
                <div className="flex flex-wrap gap-2">
                  {recentPrompts.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => onPickRecentPrompt(entry)}
                      className="max-w-full rounded-full border border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-[var(--theme-accent-border)] hover:bg-[var(--theme-accent-soft)] hover:text-white"
                      title={entry}
                    >
                      <span className="block max-w-[220px] truncate">{entry}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] px-3 py-4 text-sm text-slate-400">
                  {isChinese
                    ? '这里会记住你最近发给 agent 的问题，点击就能重新带回输入框。'
                    : 'Your latest prompts will show up here so you can reuse them with one click.'}
                </div>
              )}

              <div className="grid gap-3">
                <div className={WORKBENCH_PANEL_MUTED_CLASS}>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <Keyboard className="h-3.5 w-3.5" />
                    {isChinese ? '发送快捷键' : 'Shortcut'}
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {isChinese ? '`Ctrl/Cmd + Enter` 发送，`Enter` 换行。' : '`Ctrl/Cmd + Enter` sends, `Enter` adds a new line.'}
                  </div>
                </div>
                <div className={WORKBENCH_PANEL_MUTED_CLASS}>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-500">
                    <CornerDownLeft className="h-3.5 w-3.5" />
                    {isChinese ? '发送方式' : 'Delivery'}
                  </div>
                  <div className="mt-2 text-sm text-slate-300">
                    {isChinese
                      ? '优先复用当前 terminal；没有打开会话时会自动新建并发出首条消息。'
                      : 'Reuses the current terminal when possible, otherwise creates one and delivers the first message automatically.'}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {chatError ? <InlineNotice tone="error">{chatError}</InlineNotice> : null}
    </section>
  );
}

function GuideStepCard({
  done,
  title,
  description,
}: {
  done: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className={WORKBENCH_PANEL_MUTED_CLASS}>
      <div className="flex items-center gap-2 text-sm text-slate-100">
        <CheckCircle2
          className={cn(
            'h-4 w-4',
            done ? 'text-emerald-300' : 'text-slate-500'
          )}
        />
        <span>{title}</span>
      </div>
      <div className="mt-2 text-xs leading-5 text-slate-400">{description}</div>
    </div>
  );
}

function WorkbenchMiniMetric({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: typeof GitBranch;
}) {
  return (
    <div className={WORKBENCH_PANEL_MUTED_CLASS}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{helper}</div>
    </div>
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
          : 'border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] hover:bg-white/[0.08]'
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

function WorkbenchPageChip({
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
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition',
        active
          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
          : 'border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] text-slate-300 hover:bg-white/[0.08]'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
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
          : 'border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] text-slate-300 hover:bg-white/[0.08]'
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
          : 'border-[var(--theme-panel-border)] bg-[var(--theme-input-bg)] text-slate-400 hover:text-slate-200',
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
  await apiFetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
}

async function stopAgentTask(taskId: string) {
  await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/stop`, { method: 'POST' });
}

async function stopTerminal(terminalId: string) {
  await apiFetch(`/api/terminals/${encodeURIComponent(terminalId)}/stop`, { method: 'POST' });
}

async function stopRelay(relayId: string) {
  await apiFetch(`/api/relays/${encodeURIComponent(relayId)}/stop`, { method: 'POST' });
}

async function pauseRelay(relayId: string) {
  const response = await apiFetch(`/api/relays/${encodeURIComponent(relayId)}/pause`, {
    method: 'POST',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'Failed to pause relay.');
  }
}

async function resumeRelay(relayId: string) {
  const response = await apiFetch(`/api/relays/${encodeURIComponent(relayId)}/resume`, {
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
    const response = await apiFetch(input, {
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
  systemPrompt?: string;
  focus?: string;
  deliverable?: string;
  promptPlaceholder?: string;
  promptIdeas?: string[];
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
      focus: isChinese
        ? '先由架构视角澄清问题和边界，再由实现者提出落地方案，最后由评审者专门挑出风险、缺测和回归点。'
        : 'Clarify the problem first, move into implementation strategy second, then let a reviewer stress-test risks, missing tests, and regressions.',
      deliverable: isChinese
        ? '输出一个能直接进入开发的计划，至少包含实现路径、验证方式、主要风险和 merge 前检查项。'
        : 'Produce a plan that can directly enter development, including implementation path, validation, key risks, and merge-readiness checks.',
      systemPrompt: isChinese
        ? '你们处在一个三人评审房间里。第一位聚焦问题定义、架构与边界；第二位聚焦具体实现、代码改动与可执行步骤；第三位聚焦风险、测试、回归与 PR 质量。每一轮都必须推进结论，不要重复前文。最终请收敛成一个可执行方案，并明确仍未解决的风险。'
        : 'You are operating in a three-seat review room. Seat one clarifies the problem, architecture, and boundaries. Seat two proposes concrete implementation steps and code changes. Seat three stress-tests risk, test coverage, regressions, and PR quality. Every turn must move the conclusion forward instead of repeating prior context. End by converging on an actionable plan and remaining risks.',
      promptPlaceholder: isChinese
        ? '例如：围绕这个功能或 bug，输出实现方案、测试清单、风险与 merge 建议。'
        : 'Example: review this feature or bug and produce an implementation plan, test checklist, risks, and merge recommendation.',
      promptIdeas: isChinese
        ? [
            '围绕这个 bug 讨论 root cause、修复路径、边界条件和回归测试。',
            '审视当前改动是否可以 merge，并给出必须补做的 tests 与 review comments。',
            '把这个功能拆成最小可交付步骤，并列出实现顺序、风险和验收标准。',
          ]
        : [
            'Discuss the root cause, fix path, edge cases, and regression tests for this bug.',
            'Review whether the current changes are merge-ready and list the tests and review comments still required.',
            'Break this feature into the smallest shippable steps, with implementation order, risks, and acceptance criteria.',
          ],
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
      focus: isChinese
        ? '像一个上线指挥室：先确认目标和范围，再推进构建与修补，最后形成是否发布的明确决策。'
        : 'Acts like a shipping room: align on scope, push through implementation and fixes, then make a clear ship decision.',
      deliverable: isChinese
        ? '给出一个可交付结论，至少包括当前状态、剩余阻塞、建议动作、测试和回滚考虑。'
        : 'End with a shipping conclusion that includes current status, blockers, recommended next action, tests, and rollback considerations.',
      systemPrompt: isChinese
        ? '你们在一个交付房间里协作。构建者负责推进方案和代码实现，产品负责人负责对齐目标与优先级，修复者负责查漏补缺与降风险，发布官负责决定是否可发布。你们必须偏向交付、避免空谈，并在最后形成清晰的 go / no-go 建议和收尾动作。'
        : 'You are collaborating inside a delivery room. The builder pushes implementation forward, the product lead aligns scope and priorities, the fixer closes gaps and reduces risk, and the ship captain decides release readiness. Bias toward delivery, avoid abstract debate, and finish with a clear go/no-go recommendation plus follow-up actions.',
      promptPlaceholder: isChinese
        ? '例如：围绕这次交付讨论发布路径、剩余阻塞、修补动作和最终上线建议。'
        : 'Example: discuss the shipping path, remaining blockers, patch plan, and final release recommendation for this delivery.',
      promptIdeas: isChinese
        ? [
            '围绕这次版本交付，判断现在离可上线还差哪些动作，并排出优先级。',
            '讨论当前 PR / diff 是否足够安全，给出继续推进、补修还是暂停发布的建议。',
            '把这个需求压缩成今天能交付的最小版本，并写出验证步骤和回滚预案。',
          ]
        : [
            'Decide what still stands between this release and a safe ship, then prioritize the remaining actions.',
            'Discuss whether the current PR or diff is safe enough, and recommend push forward, patch further, or pause release.',
            'Compress this request into the smallest version that can ship today, including validation steps and rollback plans.',
          ],
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
    focus: isChinese
      ? '一个主讲推进观点，另一个负责追问、挑战和收敛，适合快速形成单一结论。'
      : 'One lead agent pushes the argument forward while the other challenges assumptions and drives convergence.',
    deliverable: isChinese
      ? '输出一个简洁但明确的结论，最好附带下一步行动、风险提醒或可选方案。'
      : 'Produce a concise but explicit conclusion, ideally with next steps, risk notes, or a fallback option.',
    systemPrompt: isChinese
      ? '你们是一个双人协作房间。主讲负责提出判断、方案和推进节奏；评审负责指出疑点、边界条件和替代路径。每一轮都要推进结论，而不是重复摘要。结束时请给出统一结论，并说明还存在的分歧或待验证点。'
      : 'You are a two-agent collaboration room. The lead agent proposes the judgement, plan, and momentum; the reviewer highlights uncertainties, edge cases, and alternatives. Every turn must advance the conclusion rather than restating the summary. Finish with one aligned recommendation and any remaining disagreements or validation gaps.',
    promptPlaceholder: isChinese
      ? '例如：围绕这个问题给出两套方案，比较权衡后收敛成一个推荐结论。'
      : 'Example: compare two approaches for this problem and converge on one recommended path.',
    promptIdeas: isChinese
      ? [
          '围绕这个需求给出两套方案，比较成本、风险和收益后收敛成一个推荐结论。',
          '把这次代码改动当成 review duel：一方主张可交付，一方专门找风险，最后统一建议。',
          '就这个技术选择进行短回合辩论，最后给出明确决策和后续行动。',
        ]
      : [
          'Generate two approaches for this requirement, compare cost, risk, and upside, then converge on one recommendation.',
          'Treat the current change set as a review duel: one agent argues it is ready to ship, the other searches for risk, then align on the final recommendation.',
          'Run a short technical debate over this choice and finish with a clear decision and next actions.',
        ],
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

function downloadTaskPackage(
  task: AgentTaskDTO,
  logs: RunLogEntryDTO[],
  events: AgentTaskEventDTO[],
  run: RunSessionDTO | null,
  isChinese: boolean
) {
  if (typeof window === 'undefined') return;
  const markdown = buildTaskPackageMarkdown(task, logs, events, run, isChinese);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const titleBase = task.title || task.branchName || task.repoName || 'task-delivery';
  anchor.href = url;
  anchor.download = `${slugify(titleBase, 'task-delivery')}-package.md`;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function buildTaskPackageMarkdown(
  task: AgentTaskDTO,
  logs: RunLogEntryDTO[],
  events: AgentTaskEventDTO[],
  run: RunSessionDTO | null,
  isChinese: boolean
) {
  const title =
    task.title || (isChinese ? '任务交付包' : 'Task delivery package');
  const lines: Array<string | null> = [
    `# ${title}`,
    '',
    `- ${isChinese ? '状态' : 'Status'}: ${task.status}`,
    `- ${isChinese ? '提供方' : 'Provider'}: ${task.provider}`,
    `- ${isChinese ? '模式' : 'Mode'}: ${task.mode}`,
    `- ${isChinese ? '仓库' : 'Repo'}: ${task.repoName}`,
    `- ${isChinese ? '工作区' : 'Workspace'}: ${task.cwd}`,
    `- ${isChinese ? '分支' : 'Branch'}: ${task.baseBranch} -> ${task.branchName}`,
    `- ${isChinese ? '工作区状态' : 'Working tree'}: ${task.workingTreeStatus}`,
    `- ${isChinese ? '创建时间' : 'Created'}: ${formatPackageTimestamp(task.createdAtMs)}`,
    task.startedAtMs
      ? `- ${isChinese ? '开始时间' : 'Started'}: ${formatPackageTimestamp(task.startedAtMs)}`
      : null,
    task.endedAtMs
      ? `- ${isChinese ? '结束时间' : 'Ended'}: ${formatPackageTimestamp(task.endedAtMs)}`
      : null,
  ];

  if (task.sourceIssue) {
    lines.push(
      `- ${isChinese ? '关联 Issue' : 'Issue'}: #${task.sourceIssue.number} ${task.sourceIssue.title} (${task.sourceIssue.url})`
    );
  }

  if (task.pullRequest) {
    lines.push(
      `- ${isChinese ? '关联 PR' : 'Pull request'}: #${task.pullRequest.number} ${task.pullRequest.title} (${task.pullRequest.url})`,
      `- ${isChinese ? 'PR 状态' : 'PR state'}: ${task.pullRequest.state}`
    );
  }

  lines.push(
    '',
    `## ${isChinese ? '提示词' : 'Prompt'}`,
    '',
    task.prompt || (isChinese ? '_未提供提示词。_' : '_No prompt provided._'),
    '',
    `## ${isChinese ? 'Diff 摘要' : 'Diff summary'}`,
    '',
    '```',
    task.diffStat ?? (isChinese ? '暂无 diff。' : 'No diff summary yet.'),
    '```',
    ''
  );

  if (task.changedFiles.length > 0) {
    lines.push(`### ${isChinese ? '变更文件' : 'Changed files'}`, '');
    for (const file of task.changedFiles) {
      lines.push(`- ${file.status}: ${file.path}`);
    }
    lines.push('');
  } else {
    lines.push(
      `${isChinese ? '暂无变更文件。' : 'No changed files detected yet.'}`,
      ''
    );
  }

  if (task.diffExcerpt) {
    lines.push(
      `### ${isChinese ? 'Diff 片段' : 'Diff excerpt'}`,
      '',
      '```diff',
      task.diffExcerpt,
      '```',
      ''
    );
  }

  lines.push(
    `## ${isChinese ? '测试结果' : 'Test results'}`,
    '',
    `- ${isChinese ? '状态' : 'Status'}: ${task.testResult.status}`,
    `- ${isChinese ? '命令' : 'Command'}: ${task.testResult.command ?? task.testCommand ?? 'n/a'}`,
    `- ${isChinese ? '退出码' : 'Exit code'}: ${task.testResult.exitCode ?? 'n/a'}`,
    `- ${isChinese ? '开始时间' : 'Started'}: ${formatPackageTimestamp(task.testResult.startedAtMs)}`,
    `- ${isChinese ? '结束时间' : 'Ended'}: ${formatPackageTimestamp(task.testResult.endedAtMs)}`,
    task.testResult.error
      ? `- ${isChinese ? '错误' : 'Error'}: ${task.testResult.error}`
      : null,
    '',
    '```text',
    task.testResult.output || (isChinese ? '没有测试输出。' : 'No test output.'),
    '```',
    ''
  );

  lines.push(`## ${isChinese ? '运行信息' : 'Run details'}`, '');
  if (run) {
    lines.push(
      `- ${isChinese ? 'Run ID' : 'Run ID'}: ${run.id}`,
      `- ${isChinese ? '状态' : 'Status'}: ${run.status}`,
      `- ${isChinese ? '命令' : 'Command'}: ${run.command.join(' ')}`,
      `- ${isChinese ? '退出码' : 'Exit code'}: ${run.exitCode ?? 'n/a'}`,
      `- ${isChinese ? '开始时间' : 'Started'}: ${formatPackageTimestamp(run.startedAtMs)}`,
      `- ${isChinese ? '结束时间' : 'Ended'}: ${formatPackageTimestamp(run.endedAtMs)}`,
      run.error ? `- ${isChinese ? '错误' : 'Error'}: ${run.error}` : null,
      ''
    );
  } else {
    lines.push(
      isChinese ? '当前任务未绑定 run。' : 'No run attached to this task yet.',
      ''
    );
  }

  lines.push(`## ${isChinese ? '运行日志' : 'Run logs'}`, '');
  const logLines = buildRunLogLines(logs);
  if (logLines.length > 0) {
    lines.push('```text', ...logLines, '```', '');
  } else {
    lines.push(isChinese ? '暂无日志。' : 'No logs captured yet.', '');
  }

  lines.push(`## ${isChinese ? '任务事件' : 'Task events'}`, '');
  if (events.length > 0) {
    const sortedEvents = [...events].sort((a, b) => a.createdAtMs - b.createdAtMs);
    for (const entry of sortedEvents) {
      lines.push(
        `- ${formatPackageTimestamp(entry.createdAtMs)} [${entry.tone}] ${entry.kind}: ${entry.message}`
      );
    }
    lines.push('');
  } else {
    lines.push(isChinese ? '暂无事件。' : 'No task events yet.', '');
  }

  return lines.filter((line): line is string => line !== null).join('\n');
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

function formatPackageTimestamp(timestampMs?: number | null) {
  if (!timestampMs) return 'n/a';
  return new Date(timestampMs).toLocaleString();
}

function buildRunLogLines(logs: RunLogEntryDTO[]) {
  if (!logs.length) return [];
  const sorted = [...logs].sort((a, b) => a.timestampMs - b.timestampMs);
  const lines: string[] = [];
  for (const entry of sorted) {
    const time = formatPackageTimestamp(entry.timestampMs);
    const chunks = entry.text.split(/\r?\n/);
    for (const chunk of chunks) {
      if (!chunk) continue;
      lines.push(`${time} [${entry.stream}] ${chunk}`);
    }
  }
  return lines;
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

function slugify(value: string, fallback = 'agent-relay') {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || fallback;
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
  await apiFetch(`/api/terminals/${encodeURIComponent(terminalId)}/resize`, {
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

function cliCheckBadgeClass(status: 'ready' | 'missing' | 'error') {
  if (status === 'ready') {
    return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
  }
  if (status === 'missing') {
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
    if (!isWorkbenchPage(parsed.page)) return null;
    if (parsed.provider !== 'claude' && parsed.provider !== 'codex') return null;
    if (parsed.mode !== 'task' && parsed.mode !== 'resume') return null;

    return {
      uiMode: parsed.uiMode === 'advanced' ? 'advanced' : 'guided',
      showAdvancedControls: parsed.showAdvancedControls === true,
      page: parsed.page,
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

function isWorkbenchPage(value: unknown): value is WorkbenchPage {
  return (
    value === 'chat' ||
    value === 'launch' ||
    value === 'task' ||
    value === 'run' ||
    value === 'terminal' ||
    value === 'relay' ||
    value === 'history'
  );
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
