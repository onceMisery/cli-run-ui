import { Suspense, lazy, useDeferredValue, useMemo, useState } from 'react';
import type { MessageDTO, SessionDTO } from '@cli-run-ui/core';
import {
  Activity,
  Bot,
  Clock3,
  FolderKanban,
  Search,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';

import { useSessionStream } from './hooks/useSessionStream.ts';
import { useConversationStream } from './hooks/useConversationStream.ts';
import { useRunSessions } from './hooks/useRunSessions.ts';
import { useTaskSessions } from './hooks/useTaskSessions.ts';
import { useTerminalSessions } from './hooks/useTerminalSessions.ts';
import { useAgentRelaySessions } from './hooks/useAgentRelaySessions.ts';
import { SessionList } from './views/SessionList.tsx';
import { HeaderBar } from './views/HeaderBar.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Button } from './components/ui/button.tsx';
import { cn } from './lib/utils.ts';
import {
  formatCompactNumber,
  formatRelativeTime,
  useI18n,
  type Language,
} from './lib/i18n.tsx';
import { useTheme } from './lib/theme.tsx';

type ProviderFilter = 'all' | SessionDTO['provider'];

const ConversationView = lazy(async () => {
  const module = await import('./views/ConversationView.tsx');
  return { default: module.ConversationView };
});

const AgentWorkbenchPanel = lazy(async () => {
  const module = await import('./views/AgentWorkbenchPanel.tsx');
  return { default: module.AgentWorkbenchPanel };
});

export default function App() {
  const { theme, setTheme, themes } = useTheme();
  const { language, isChinese, setLanguage } = useI18n();
  const { sessions, status: sessionStatus } = useSessionStream();
  const { runs, status: runStatus } = useRunSessions();
  const { tasks, status: taskStatus } = useTaskSessions();
  const { terminals, status: terminalStatus } = useTerminalSessions();
  const { relays, status: relayStatus } = useAgentRelaySessions();
  const [activeSessionUid, setActiveSessionUid] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const filteredSessions = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();

    return sessions.filter((session) => {
      if (providerFilter !== 'all' && session.provider !== providerFilter) return false;
      if (!normalized) return true;

      return [
        session.title,
        session.projectName,
        session.projectPath,
        session.sessionId,
        session.source.filePath,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized));
    });
  }, [deferredQuery, providerFilter, sessions]);

  const resolvedActiveUid = useMemo(() => {
    if (
      activeSessionUid &&
      filteredSessions.some((session) => session.uid === activeSessionUid)
    ) {
      return activeSessionUid;
    }

    if (activeSessionUid && sessions.some((session) => session.uid === activeSessionUid)) {
      return activeSessionUid;
    }

    return filteredSessions[0]?.uid ?? sessions[0]?.uid ?? null;
  }, [activeSessionUid, filteredSessions, sessions]);

  const activeSession =
    sessions.find((session) => session.uid === resolvedActiveUid) ?? null;
  const { messages, status: conversationStatus } =
    useConversationStream(resolvedActiveUid);

  const totalUsage = useMemo(
    () =>
      sessions.reduce((sum, session) => {
        const usage = session.usage;
        if (!usage) return sum;
        if (typeof usage.total === 'number') return sum + usage.total;
        return sum + (usage.input ?? 0) + (usage.output ?? 0);
      }, 0),
    [sessions]
  );

  const providerCounts = useMemo(
    () => ({
      claude: sessions.filter((session) => session.provider === 'claude').length,
      codex: sessions.filter((session) => session.provider === 'codex').length,
    }),
    [sessions]
  );

  const projectCount = useMemo(
    () => new Set(sessions.map((session) => session.projectPath ?? session.projectName)).size,
    [sessions]
  );
  const runningCount = useMemo(
    () =>
      runs.filter((run) => run.status === 'running' || run.status === 'starting').length,
    [runs]
  );
  const activeTerminalCount = useMemo(
    () =>
      terminals.filter(
        (terminal) => terminal.status === 'open' || terminal.status === 'starting'
      ).length,
    [terminals]
  );
  const activeTaskCount = useMemo(
    () =>
      tasks.filter((task) => task.status === 'preparing' || task.status === 'running').length,
    [tasks]
  );
  const activeRelayCount = useMemo(
    () =>
      relays.filter((relay) => relay.status === 'running' || relay.status === 'starting')
        .length,
    [relays]
  );

  const highlightedProjects = useMemo(() => {
    const grouped = new Map<
      string,
      { count: number; updatedAtMs: number; providerSet: Set<SessionDTO['provider']> }
    >();

    for (const session of filteredSessions) {
      const key = session.projectName || (isChinese ? '未知项目' : 'Unknown project');
      const current = grouped.get(key) ?? {
        count: 0,
        updatedAtMs: 0,
        providerSet: new Set<SessionDTO['provider']>(),
      };
      current.count += 1;
      current.updatedAtMs = Math.max(current.updatedAtMs, session.updatedAtMs);
      current.providerSet.add(session.provider);
      grouped.set(key, current);
    }

    return Array.from(grouped.entries())
      .map(([name, meta]) => ({
        name,
        count: meta.count,
        updatedAtMs: meta.updatedAtMs,
        providers: Array.from(meta.providerSet.values()),
      }))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, 4);
  }, [filteredSessions, isChinese]);

  return (
    <div className="app-shell min-h-screen text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-6 px-4 py-4 lg:px-6">
        <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)_320px]">
          <aside className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,28,0.96),rgba(8,14,24,0.88))] shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="border-b border-white/10 px-5 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Badge className="w-fit border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]">
                    {isChinese ? '多 Agent 工作台' : 'Multi-agent runboard'}
                  </Badge>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-white">
                      cli-run-ui
                    </h1>
                    <p className="mt-1 text-sm text-slate-300">
                      {isChinese
                        ? '把本地 Claude 与 Codex 会话聚合到同一个精致工作台里，便于浏览、恢复和继续协作。'
                        : 'Aggregate local Claude and Codex sessions into one polished runboard for fast browsing, resuming, and orchestration.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-3">
                  <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
                    <button
                      onClick={() => setLanguage('en')}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs transition',
                        language === 'en'
                          ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
                          : 'text-slate-400 hover:text-slate-100'
                      )}
                    >
                      EN
                    </button>
                    <button
                      onClick={() => setLanguage('zh-CN')}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs transition',
                        language === 'zh-CN'
                          ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
                          : 'text-slate-400 hover:text-slate-100'
                      )}
                    >
                      中文
                    </button>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">
                    {themes.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setTheme(option.id)}
                        title={option.label}
                        aria-label={option.label}
                        className={cn(
                          'h-5 w-5 rounded-full border transition',
                          theme === option.id
                            ? 'scale-110 border-white shadow-[0_0_0_2px_rgba(255,255,255,0.18)]'
                            : 'border-white/10 hover:scale-105'
                        )}
                        style={{ backgroundImage: option.swatch }}
                      />
                    ))}
                  </div>
                  <StatusBeacon status={sessionStatus} isChinese={isChinese} />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <MetricCard
                  icon={Activity}
                  label={isChinese ? '活跃会话' : 'Live sessions'}
                  value={sessions.length}
                  helper={
                    isChinese ? `当前可见 ${filteredSessions.length}` : `${filteredSessions.length} visible`
                  }
                />
                <MetricCard
                  icon={FolderKanban}
                  label={isChinese ? '项目数' : 'Projects'}
                  value={projectCount}
                  helper={isChinese ? '按工作区聚合' : 'grouped workspaces'}
                />
                <MetricCard
                  icon={Bot}
                  label="Claude"
                  value={providerCounts.claude}
                  helper={isChinese ? '已索引会话' : 'indexed sessions'}
                />
                <MetricCard
                  icon={TerminalSquare}
                  label="Codex"
                  value={providerCounts.codex}
                  helper={
                    isChinese
                      ? `${runningCount} 个 run / ${activeTerminalCount} 个 terminal / ${activeRelayCount} 个 relay`
                      : `${runningCount} runs / ${activeTaskCount} tasks / ${activeTerminalCount} terminals / ${activeRelayCount} relays`
                  }
                />
              </div>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      isChinese ? '搜索项目、会话、路径...' : 'Search project, session, path...'
                    }
                    className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <FilterChip
                    active={providerFilter === 'all'}
                    onClick={() => setProviderFilter('all')}
                  >
                    {isChinese ? '全部' : 'All'}
                  </FilterChip>
                  <FilterChip
                    active={providerFilter === 'claude'}
                    onClick={() => setProviderFilter('claude')}
                  >
                    Claude
                  </FilterChip>
                  <FilterChip
                    active={providerFilter === 'codex'}
                    onClick={() => setProviderFilter('codex')}
                  >
                    Codex
                  </FilterChip>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">
                      {isChinese ? '会话列表' : 'Sessions'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {isChinese
                        ? '按最近活动排序，更接近 `claude-run` 那种快速切换上下文的使用方式。'
                        : 'Sorted by recent activity so it feels closer to a `claude-run` style workspace switcher.'}
                    </div>
                  </div>
                  <Badge variant="muted" className="bg-white/5 text-slate-300">
                    {filteredSessions.length}
                  </Badge>
                </div>
                <SessionList
                  sessions={filteredSessions}
                  activeUid={resolvedActiveUid}
                  onSelect={setActiveSessionUid}
                />
              </div>
            </div>
          </aside>

          <main className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(7,16,26,0.95),rgba(7,13,22,0.84))] shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <HeaderBar
              session={activeSession}
              sessionStatus={sessionStatus}
              conversationStatus={conversationStatus}
              messageCount={messages.length}
            />
            <Suspense
              fallback={
                <PanelFallback
                  text={
                    isChinese ? '正在加载对话工作区...' : 'Loading conversation workspace...'
                  }
                />
              }
            >
              <ConversationView session={activeSession} messages={messages} />
            </Suspense>
          </main>

          <aside className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,15,28,0.96),rgba(8,14,24,0.88))] shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
            <div className="space-y-4 px-5 py-5">
              <InsightPanel
                activeSession={activeSession}
                messages={messages}
                totalUsage={totalUsage}
              />

              <Suspense
                fallback={
                  <PanelFallback
                    text={isChinese ? '正在加载 Agent 工作台...' : 'Loading agent workspace...'}
                  />
                }
              >
                <AgentWorkbenchPanel
                  activeSession={activeSession}
                  runs={runs}
                  runStatus={runStatus}
                  tasks={tasks}
                  taskStatus={taskStatus}
                  terminals={terminals}
                  terminalStatus={terminalStatus}
                  relays={relays}
                  relayStatus={relayStatus}
                />
              </Suspense>

              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <Sparkles className="h-4 w-4 text-amber-300" />
                  {isChinese ? '重点项目' : 'Spotlight Projects'}
                </div>
                <div className="mt-3 space-y-3">
                  {highlightedProjects.length === 0 ? (
                    <EmptyMiniState text={isChinese ? '还没有可展示的会话。' : 'No indexed sessions yet.'} />
                  ) : (
                    highlightedProjects.map((project) => (
                      <div
                        key={project.name}
                        className="rounded-2xl border border-white/10 bg-black/20 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">
                              {project.name}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {isChinese ? '更新于 ' : 'Updated '}
                              {formatRelativeTime(project.updatedAtMs, language)}
                            </div>
                          </div>
                          <Badge variant="muted" className="bg-white/5 text-slate-300">
                            {project.count}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {project.providers.map((provider) => (
                            <Badge
                              key={`${project.name}-${provider}`}
                              className={providerBadgeClass(provider)}
                            >
                              {provider}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

function StatusBeacon({
  status,
  isChinese,
}: {
  status: 'connecting' | 'open' | 'closed';
  isChinese: boolean;
}) {
  const palette =
    status === 'open'
      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
      : status === 'closed'
        ? 'border-rose-400/30 bg-rose-400/10 text-rose-100'
        : 'border-amber-400/30 bg-amber-400/10 text-amber-100';

  const label = isChinese
    ? status === 'open'
      ? '实时同步'
      : status === 'closed'
        ? '等待重连'
        : '连接中'
    : status === 'open'
      ? 'Live sync'
      : status === 'closed'
        ? 'Reconnect'
        : 'Connecting';

  return (
    <div className={cn('rounded-full border px-3 py-1 text-xs font-medium', palette)}>
      {label}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{helper}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition',
        active
          ? 'border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)] text-[var(--theme-accent-text)]'
          : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200'
      )}
    >
      {children}
    </button>
  );
}

function InsightPanel({
  activeSession,
  messages,
  totalUsage,
}: {
  activeSession: SessionDTO | null;
  messages: MessageDTO[];
  totalUsage: number;
}) {
  const { language, isChinese } = useI18n();
  const assistantMessages = messages.filter((message) => message.role === 'assistant').length;
  const toolMessages = messages.filter((message) => message.role === 'tool').length;
  const latestModel = [...messages]
    .reverse()
    .find((message) => typeof message.model === 'string' && message.model.length > 0)?.model;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <Clock3 className="h-4 w-4 text-emerald-300" />
        {isChinese ? '会话洞察' : 'Session Insights'}
      </div>
      {activeSession ? (
        <div className="mt-4 space-y-3">
          <InsightStat label={isChinese ? '提供方' : 'Provider'} value={activeSession.provider} />
          <InsightStat label={isChinese ? '消息数' : 'Messages'} value={String(messages.length)} />
          <InsightStat
            label={isChinese ? '助手回复' : 'Assistant turns'}
            value={String(assistantMessages)}
          />
          <InsightStat
            label={isChinese ? '工具输出' : 'Tool outputs'}
            value={String(toolMessages)}
          />
          <InsightStat
            label={isChinese ? 'Token 体量' : 'Token volume'}
            value={formatUsage(activeSession.usage, language) ?? 'n/a'}
          />
          <InsightStat
            label={isChinese ? '最新模型' : 'Latest model'}
            value={latestModel ?? (isChinese ? '未知' : 'unknown')}
          />
          <InsightStat label="Transcript" value={truncateMiddle(activeSession.source.filePath, 36)} />
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-white/10 bg-white/[0.03] text-slate-100 hover:bg-white/[0.08]"
              onClick={() => void navigator.clipboard.writeText(activeSession.resumeCommand)}
            >
              {isChinese ? '复制恢复命令' : 'Copy resume command'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <EmptyMiniState text={isChinese ? '选择一个会话查看详情。' : 'Select a session to inspect details.'} />
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-3">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
          {isChinese ? '索引规模' : 'Indexed footprint'}
        </div>
        <div className="mt-2 text-2xl font-semibold text-white">
          {formatCompactNumber(totalUsage, language)}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {isChinese
            ? '当前已索引 provider 的总 token 使用量'
            : 'Total token usage observed across indexed providers'}
        </div>
      </div>
    </section>
  );
}

function InsightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <span className="max-w-[170px] truncate text-sm text-slate-100">{value}</span>
    </div>
  );
}

function EmptyMiniState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

function PanelFallback({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-slate-400">
      {text}
    </div>
  );
}

function providerBadgeClass(provider: SessionDTO['provider']) {
  return provider === 'claude'
    ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
}

function formatUsage(usage: SessionDTO['usage'] | undefined, language: Language): string | null {
  if (!usage) return null;
  if (typeof usage.total === 'number') return formatCompactNumber(usage.total, language);
  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  if (input === 0 && output === 0) return null;
  return `${formatCompactNumber(input, language)} / ${formatCompactNumber(output, language)}`;
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const keep = Math.max(6, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

export type { SessionDTO, MessageDTO };
