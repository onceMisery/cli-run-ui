import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageDTO, SessionDTO, ContentPart } from '@cli-run-ui/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
    return <div className="conversation empty">Select a session to view messages.</div>;
  }

  return (
    <div className="conversation" ref={parentRef}>
      <div className="conversation-spacer" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const message = messages[virtualRow.index];
          return (
            <div
              key={message.id}
              className="conversation-row"
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
    <div className={`message ${message.role}`}>
      <div className="message-meta">
        <span className="role">{message.role}</span>
        <span className="muted">{new Date(message.createdAtMs).toLocaleTimeString()}</span>
      </div>
      <div className="message-body">
        {message.parts.map((part, index) => {
          if (part.kind === 'text') {
            return (
              <div key={`${message.id}-text-${index}`} className="part text">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
              </div>
            );
          }
          if (part.kind === 'code') {
            return (
              <pre key={`${message.id}-code-${index}`} className="part code">
                <code>{part.text}</code>
              </pre>
            );
          }
          if (part.kind === 'reasoning') {
            return (
              <details key={`${message.id}-reasoning-${index}`} className="part reasoning">
                <summary>{part.summary || 'Reasoning'}</summary>
                <div className="muted">
                  {part.encrypted ? 'Encrypted reasoning' : 'Reasoning details hidden'}
                </div>
              </details>
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
              <pre key={`${message.id}-raw-${index}`} className="part raw">
                <code>{JSON.stringify(part.json, null, 2)}</code>
              </pre>
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
    <details className="part tool">
      <summary>
        <span className="tool-label">Tool: {call.name}</span>
        {result?.isError ? <span className="tool-error">error</span> : null}
      </summary>
      <div className="tool-body">
        <div>
          <div className="tool-heading">Input</div>
          <pre className="tool-input">
            <code>{JSON.stringify(call.input, null, 2)}</code>
          </pre>
        </div>
        <div>
          <div className="tool-heading">Output</div>
          <pre className="tool-output">
            <code>{result?.output ?? ''}</code>
          </pre>
        </div>
      </div>
    </details>
  );
}

function ToolResultBlock({ result }: { result: Extract<ContentPart, { kind: 'tool_result' }> }) {
  return (
    <div className="part tool">
      <div className="tool-heading">Tool output</div>
      <pre className="tool-output">
        <code>{result.output}</code>
      </pre>
    </div>
  );
}
