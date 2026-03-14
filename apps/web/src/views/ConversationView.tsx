import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContentPart, MessageDTO, SessionDTO } from '@cli-run-ui/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  Check,
  ChevronRight,
  Copy,
  Sparkles,
  TerminalSquare,
  UserRound,
} from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { formatRelativeTime, useI18n } from '@/lib/i18n';

interface ConversationViewProps {
  session: SessionDTO | null;
  messages: MessageDTO[];
}

export function ConversationView({ session, messages }: ConversationViewProps) {
  const { isChinese } = useI18n();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 176,
    overscan: 8,
  });

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 140;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setStickToBottom(atBottom);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottom || messages.length === 0) return;
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [messages.length, rowVirtualizer, stickToBottom]);

  if (!session) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        <div className="max-w-md rounded-[28px] border border-dashed border-white/10 bg-white/[0.03] px-8 py-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--theme-accent-border)] bg-[var(--theme-accent-soft)]">
            <Sparkles className="h-6 w-6 text-[var(--theme-accent-text)]" />
          </div>
          <h2 className="mt-5 text-xl font-semibold text-white">
            {isChinese ? '选择一个实时 transcript' : 'Choose a live transcript'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {isChinese
              ? '从左侧选择 Claude 或 Codex 会话后，这里会展示消息流、工具调用和恢复相关信息。'
              : 'Choose a Claude or Codex session from the left to render the message stream, tool calls, and resume context here.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-[calc(100vh-220px)] overflow-auto px-6 py-6">
      <ConversationHero session={session} messageCount={messages.length} />

      {messages.length === 0 ? (
        <div className="mt-6 rounded-[28px] border border-dashed border-white/10 bg-black/20 px-8 py-12 text-center text-sm text-slate-400">
          {isChinese ? '等待 transcript 内容到达中。' : 'Waiting for transcript lines to arrive.'}
        </div>
      ) : (
        <div className="relative mt-6 w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const message = messages[virtualRow.index];
            return (
              <div
                key={message.id}
                className="absolute left-0 w-full pb-5"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
              >
                <MessageCard message={message} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConversationHero({
  session,
  messageCount,
}: {
  session: SessionDTO;
  messageCount: number;
}) {
  const { isChinese, language } = useI18n();

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(16,30,48,0.92),rgba(8,14,24,0.88))]">
      <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1.5fr_repeat(3,minmax(0,1fr))]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={providerBadgeClass(session.provider)}>{session.provider}</Badge>
            <Badge variant="muted" className="border-white/10 bg-white/[0.04] text-slate-300">
              {session.projectName}
            </Badge>
          </div>
          <div className="mt-4 text-xl font-semibold text-white">{session.title}</div>
          <div className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            {isChinese ? 'Transcript 来源: ' : 'Transcript source: '}
            {session.source.filePath}
          </div>
        </div>
        <HeroStat label={isChinese ? '消息数' : 'Messages'} value={String(messageCount)} />
        <HeroStat
          label={isChinese ? '最近更新' : 'Updated'}
          value={formatRelativeTime(session.updatedAtMs, language)}
        />
        <HeroStat
          label={isChinese ? '恢复命令' : 'Resume'}
          value={session.provider === 'codex' ? 'codex --resume' : 'claude --resume'}
        />
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function MessageCard({ message }: { message: MessageDTO }) {
  const { isChinese } = useI18n();
  const toolGroups = useMemo(() => groupToolParts(message.parts), [message.parts]);
  const tone = getMessageTone(message.role);

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-[26px] border p-4 shadow-[0_20px_50px_rgba(0,0,0,0.18)]',
        tone.containerClass
      )}
    >
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-1.5', tone.barClass)} />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
              tone.iconClass
            )}
          >
            {message.role === 'user' ? (
              <UserRound className="h-4 w-4" />
            ) : message.role === 'assistant' ? (
              <Bot className="h-4 w-4" />
            ) : (
              <TerminalSquare className="h-4 w-4" />
            )}
          </div>
          <div>
            <div className={cn('text-sm font-medium', tone.titleClass)}>
              {roleLabel(message.role, isChinese)}
            </div>
            <div className="text-xs text-slate-400">
              {new Date(message.createdAtMs).toLocaleTimeString()}
              {message.model ? ` / ${message.model}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <InlineCopyButton
            value={buildMessageCopyText(message)}
            label={isChinese ? '复制消息' : 'Copy message'}
          />
          <Badge className={tone.badgeClass}>{roleBadgeLabel(message.role, isChinese)}</Badge>
          <Badge variant="muted" className="border-white/10 bg-white/[0.04] text-slate-300">
            {message.parts.length} {isChinese ? '段' : `part${message.parts.length > 1 ? 's' : ''}`}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {message.parts.map((part, index) => {
          if (part.kind === 'text') {
            return (
              <div key={`${message.id}-text-${index}`} className="leading-relaxed text-slate-100">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: MarkdownPre,
                    code: MarkdownCode,
                  }}
                >
                  {part.text}
                </ReactMarkdown>
              </div>
            );
          }
          if (part.kind === 'code') {
            const fenced = `\n\`\`\`${part.lang ?? ''}\n${part.text}\n\`\`\`\n`;
            return (
              <div key={`${message.id}-code-${index}`} className="leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre: MarkdownPre,
                    code: MarkdownCode,
                  }}
                >
                  {fenced}
                </ReactMarkdown>
              </div>
            );
          }
          if (part.kind === 'reasoning') {
            return <ReasoningBlock key={`${message.id}-reasoning-${index}`} part={part} />;
          }
          if (part.kind === 'tool_call') {
            const result = toolGroups.get(part.id);
            return (
              <ToolBlock key={`${message.id}-tool-${index}`} call={part} result={result} />
            );
          }
          if (part.kind === 'tool_result') {
            if (toolGroups.has(part.toolCallId)) return null;
            return (
              <ToolResultBlock key={`${message.id}-tool-result-${index}`} result={part} />
            );
          }
          if (part.kind === 'raw') {
            return (
              <div
                key={`${message.id}-raw-${index}`}
                className="rounded-2xl border border-white/10 bg-black/30 p-3 text-xs"
              >
                <pre className="whitespace-pre-wrap font-mono text-slate-200">
                  {JSON.stringify(part.json, null, 2)}
                </pre>
              </div>
            );
          }
          return null;
        })}
      </div>
    </article>
  );
}

function groupToolParts(parts: ContentPart[]) {
  const resultMap = new Map<string, Extract<ContentPart, { kind: 'tool_result' }>>();
  for (const part of parts) {
    if (part.kind === 'tool_result') {
      resultMap.set(part.toolCallId, part);
    }
  }
  return resultMap;
}

function ToolBlock({
  call,
  result,
}: {
  call: Extract<ContentPart, { kind: 'tool_call' }>;
  result?: Extract<ContentPart, { kind: 'tool_result' }>;
}) {
  const { isChinese } = useI18n();

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem
        value={`tool-${call.id}`}
        className="rounded-2xl border border-white/10 bg-black/20 px-1"
      >
        <AccordionTrigger className="rounded-xl px-3 py-3 text-left text-slate-100">
          <div className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4 text-slate-500" />
            <span>{isChinese ? '工具' : 'Tool'}: {call.name}</span>
            {result?.isError ? (
              <Badge className="border-rose-400/30 bg-rose-400/10 text-rose-100">
                {isChinese ? '错误' : 'error'}
              </Badge>
            ) : (
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-100">
                {isChinese ? '完成' : 'complete'}
              </Badge>
            )}
          </div>
        </AccordionTrigger>
        <AccordionContent className="mt-1 px-3 pb-3">
          <div className="grid items-start gap-3 xl:grid-cols-2">
            <ToolPanel
              label={isChinese ? '输入' : 'Input'}
              value={JSON.stringify(call.input, null, 2)}
              tone="neutral"
            />
            <ToolPanel
              label={isChinese ? '输出' : 'Output'}
              value={result?.output ?? ''}
              tone={result?.isError ? 'error' : 'success'}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function ToolPanel({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'success' | 'error';
}) {
  const { isChinese } = useI18n();

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
        <InlineCopyButton
          value={value}
          label={isChinese ? `复制${label}` : `Copy ${label}`}
        />
      </div>
      <pre
        className={cn(
          'max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl border p-3 text-xs font-mono',
          tone === 'success'
            ? 'border-emerald-400/15 bg-black/35 text-emerald-100'
            : tone === 'error'
              ? 'border-rose-400/15 bg-black/35 text-rose-100'
              : 'border-white/10 bg-black/35 text-slate-200'
        )}
      >
        {value || ' '}
      </pre>
    </div>
  );
}

function ToolResultBlock({
  result,
}: {
  result: Extract<ContentPart, { kind: 'tool_result' }>;
}) {
  const { isChinese } = useI18n();

  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
          {isChinese ? '工具输出' : 'Tool output'}
        </div>
        <InlineCopyButton
          value={result.output}
          label={isChinese ? '复制工具输出' : 'Copy tool output'}
        />
      </div>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-emerald-100">
        {result.output}
      </pre>
    </div>
  );
}

function ReasoningBlock({
  part,
}: {
  part: Extract<ContentPart, { kind: 'reasoning' }>;
}) {
  const { isChinese } = useI18n();
  const label = part.summary || (isChinese ? '推理' : 'Reasoning');

  return (
    <Collapsible>
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
        <span className="text-sm font-medium text-white">{label}</span>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-300 hover:bg-white/[0.06] hover:text-white"
          >
            {isChinese ? '展开/收起' : 'Toggle'}
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
        {part.encrypted
          ? isChinese
            ? '加密推理内容'
            : 'Encrypted reasoning'
          : isChinese
            ? '推理细节已隐藏'
            : 'Reasoning details hidden'}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MarkdownPre({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLPreElement>) {
  const text = useMemo(() => extractText(children), [children]);

  return (
    <div className="group relative">
      <CopyButton value={text} />
      <pre
        className={cn(
          'overflow-x-auto rounded-2xl border border-white/10 bg-black/50 p-4 text-xs text-slate-100',
          className
        )}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

function MarkdownCode({
  inline,
  className,
  children,
  ...props
}: { inline?: boolean } & React.HTMLAttributes<HTMLElement>) {
  if (inline) {
    return (
      <code
        className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-xs text-[var(--theme-accent-text)]"
        {...props}
      >
        {children}
      </code>
    );
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function CopyButton({ value }: { value: string }) {
  const { isChinese } = useI18n();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onCopy}
      className="absolute right-2 top-2 h-7 w-7 border border-white/10 bg-black/40 opacity-0 transition group-hover:opacity-100"
      aria-label={isChinese ? '复制代码' : 'Copy code'}
      disabled={!value}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function InlineCopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onCopy}
      className="h-7 rounded-full border border-white/10 bg-black/20 px-2.5 text-[11px] text-slate-300 hover:bg-white/[0.08] hover:text-white"
      aria-label={label}
      title={label}
      disabled={!value}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (!node || typeof node !== 'object') return '';
  if ('props' in node) {
    const props = (node as { props?: { children?: React.ReactNode } }).props;
    if (props?.children) return extractText(props.children);
  }
  return '';
}

function buildMessageCopyText(message: MessageDTO): string {
  return message.parts
    .map((part) => {
      if (part.kind === 'text') return part.text;
      if (part.kind === 'code') {
        return `\`\`\`${part.lang ?? ''}\n${part.text}\n\`\`\``;
      }
      if (part.kind === 'tool_call') {
        return `Tool call: ${part.name}\n${JSON.stringify(part.input, null, 2)}`;
      }
      if (part.kind === 'tool_result') {
        return `Tool output:\n${part.output}`;
      }
      if (part.kind === 'reasoning') {
        return part.summary ? `Reasoning: ${part.summary}` : 'Reasoning';
      }
      if (part.kind === 'raw') {
        return JSON.stringify(part.json, null, 2);
      }
      return '';
    })
    .filter((value) => value.length > 0)
    .join('\n\n');
}

function providerBadgeClass(provider: SessionDTO['provider']) {
  return provider === 'claude'
    ? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
    : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100';
}

function roleLabel(role: MessageDTO['role'], isChinese: boolean): string {
  if (!isChinese) {
    if (role === 'assistant') return 'Agent';
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  if (role === 'user') return '用户';
  if (role === 'assistant') return '智能体';
  if (role === 'system') return '系统';
  if (role === 'tool') return '工具';
  return '开发者';
}

function roleBadgeLabel(role: MessageDTO['role'], isChinese: boolean): string {
  if (role === 'assistant') return 'Agent';
  if (role === 'user') return 'User';
  if (role === 'tool') return 'Tool';
  if (role === 'system') return 'System';
  return 'Dev';
}

function getMessageTone(role: MessageDTO['role']) {
  if (role === 'user') {
    return {
      containerClass:
        'border-[var(--user-border)] bg-[image:var(--user-soft)] shadow-[0_20px_50px_var(--user-shadow)]',
      barClass: 'bg-[image:var(--user-bar)]',
      iconClass:
        'border-[var(--user-icon-border)] bg-[var(--user-icon-bg)] text-[var(--user-text)]',
      titleClass: 'text-[var(--user-text)]',
      badgeClass:
        'border-[var(--user-badge-border)] bg-[var(--user-badge-bg)] text-[var(--user-badge-text)]',
    };
  }

  if (role === 'assistant') {
    return {
      containerClass:
        'border-[var(--agent-border)] bg-[image:var(--agent-soft)] shadow-[0_20px_50px_var(--agent-shadow)]',
      barClass: 'bg-[image:var(--agent-bar)]',
      iconClass:
        'border-[var(--agent-icon-border)] bg-[var(--agent-icon-bg)] text-[var(--agent-text)]',
      titleClass: 'text-[var(--agent-text)]',
      badgeClass:
        'border-[var(--agent-badge-border)] bg-[var(--agent-badge-bg)] text-[var(--agent-badge-text)]',
    };
  }

  return {
    containerClass: 'border-white/10 bg-white/[0.03]',
    barClass: 'bg-[linear-gradient(90deg,rgba(148,163,184,0.75),rgba(148,163,184,0.12))]',
    iconClass: 'border-white/10 bg-white/[0.04] text-slate-200',
    titleClass: 'text-white',
    badgeClass: 'border-white/10 bg-white/[0.04] text-slate-300',
  };
}
