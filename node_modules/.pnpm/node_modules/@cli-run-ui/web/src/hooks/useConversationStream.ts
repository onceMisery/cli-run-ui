import { useEffect, useRef, useState } from 'react';
import type { MessageDTO } from '@cli-run-ui/core';
import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useConversationStream(sessionUid: string | null) {
  const { config } = useApiConfig();
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

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (offset: number) => {
      if (closed) return;
      setStatus('connecting');
      source?.close();
      source = apiEventSource(
        `/api/conversation/${encodeURIComponent(sessionUid)}/stream?offset=${offset}`
      );

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
      source.onerror = () => {
        if (closed) return;
        setStatus('closed');
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(offsetRef.current);
      }, 1000);
    };

    connect(0);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [config.baseUrl, config.token, sessionUid]);

  return { messages, status };
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
