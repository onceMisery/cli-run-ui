import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ContentPart, MessageDTO, SessionDTO } from '@cli-run-ui/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeShiki from '@shikijs/rehype';
import { Check, Copy } from 'lucide-react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

const markdownPlugins = [[rehypeShiki, { theme: 'vitesse-dark' }]] as const;

interface ConversationViewProps {
  session: SessionDTO | null;
  messages: MessageDTO[];
}

export function ConversationView({ session, messages }: ConversationViewProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 160,
    overscan: 6,
  });

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const handleScroll = () => {
      const threshold = 120;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      setStickToBottom(atBottom);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottom || messages.length === 0) return;
    rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [messages.length, stickToBottom, rowVirtualizer]);

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a session to view messages.
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-auto px-6 py-6">
      <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          return (
            <div
              key={message.id}
              className="absolute left-0 w-full pb-4"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
            >
              <MessageCard message={message} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MessageCard({ message }: { message: MessageDTO }) {
  const toolGroups = useMemo(() => groupToolParts(message.parts), [message.parts]);

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm',
        message.role === 'user' && 'border-l-4 border-l-secondary/80',
        message.role === 'assistant' && 'border-l-4 border-l-primary/80'
      )}
    >
      <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>{message.role}</span>
        <span>{new Date(message.createdAtMs).toLocaleTimeString()}</span>
      </div>
      <div className="flex flex-col gap-3">
        {message.parts.map((part, index) => {
          if (part.kind === 'text') {
            return (
              <div key={`${message.id}-text-${index}`} className="leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={markdownPlugins}
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
                  rehypePlugins={markdownPlugins}
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
            return (
              <ReasoningBlock key={`${message.id}-reasoning-${index}`} part={part} />
            );
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
              <div key={`${message.id}-raw-${index}`} className="rounded-xl bg-black/40 p-3 text-xs">
                <pre className="whitespace-pre-wrap font-mono">{JSON.stringify(part.json, null, 2)}</pre>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
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
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={`tool-${call.id}`} className="border-none">
        <AccordionTrigger className="rounded-lg border border-border/60 bg-background/40 px-3">
          <div className="flex items-center gap-2">
            <span>Tool: {call.name}</span>
            {result?.isError ? (
              <Badge variant="outline" className="border-rose-400/40 text-rose-200">
                error
              </Badge>
            ) : null}
          </div>
        </AccordionTrigger>
        <AccordionContent className="mt-2">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Input</div>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs font-mono">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground">Output</div>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-black/60 p-3 text-xs font-mono text-emerald-100">
                {result?.output ?? ''}
              </pre>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function ToolResultBlock({ result }: { result: Extract<ContentPart, { kind: 'tool_result' }> }) {
  return (
    <div className="rounded-xl border border-border/60 bg-black/40 p-3 text-xs">
      <div className="text-xs uppercase text-muted-foreground">Tool output</div>
      <pre className="mt-2 whitespace-pre-wrap font-mono text-emerald-100">{result.output}</pre>
    </div>
  );
}

function ReasoningBlock({ part }: { part: Extract<ContentPart, { kind: 'reasoning' }> }) {
  const label = part.summary || 'Reasoning';
  return (
    <Collapsible>
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <span className="text-sm font-medium">{label}</span>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            Toggle
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="mt-2 rounded-lg bg-black/30 p-3 text-xs text-muted-foreground">
        {part.encrypted ? 'Encrypted reasoning' : 'Reasoning details hidden'}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MarkdownPre({ className, children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const text = useMemo(() => extractText(children), [children]);

  return (
    <div className="group relative">
      <CopyButton value={text} />
      <pre
        className={cn('overflow-x-auto rounded-xl bg-black/50 p-3 text-xs', className)}
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

function MarkdownCode({ inline, className, children, ...props }: { inline?: boolean } & React.HTMLAttributes<HTMLElement>) {
  if (inline) {
    return (
      <code className="rounded bg-muted/40 px-1 py-0.5 text-xs" {...props}>
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
      className="absolute right-2 top-2 h-7 w-7 opacity-0 transition group-hover:opacity-100"
      aria-label="Copy code"
      disabled={!value}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
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
