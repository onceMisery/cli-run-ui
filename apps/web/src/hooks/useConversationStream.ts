import { useEffect, useRef, useState } from 'react';
import type { MessageDTO } from '@cli-run-ui/core';
import type { StreamStatus } from './useSessionStream.ts';

export function useConversationStream(sessionUid: string | null) {
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!sessionUid) {
      setMessages([]);
      setStatus('closed');
      offsetRef.current = 0;
      return;
    }

    setMessages([]);
    setStatus('connecting');
    offsetRef.current = 0;

    const source = new EventSource(`/api/conversation/${encodeURIComponent(sessionUid)}/stream?offset=0`);

    source.addEventListener('messages', (event) => {
      const data = safeParse(event.data);
      if (!data || typeof data !== 'object') return;
      const payload = data as { messages?: MessageDTO[]; nextOffset?: number };
      if (Array.isArray(payload.messages) && payload.messages.length > 0) {
        setMessages((prev) => [...prev, ...payload.messages!]);
      }
      if (typeof payload.nextOffset === 'number' && Number.isFinite(payload.nextOffset)) {
        offsetRef.current = payload.nextOffset;
      }
    });

    source.onopen = () => setStatus('open');
    source.onerror = () => setStatus('closed');

    return () => {
      source.close();
    };
  }, [sessionUid]);

  return { messages, status };
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}