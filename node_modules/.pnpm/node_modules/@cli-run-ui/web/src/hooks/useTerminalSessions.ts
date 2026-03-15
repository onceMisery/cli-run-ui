import { useEffect, useState } from 'react';
import type { TerminalSessionDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useTerminalSessions() {
  const { config } = useApiConfig();
  const [terminals, setTerminals] = useState<TerminalSessionDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      source?.close();
      source = apiEventSource('/api/terminals/stream');

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as { terminals?: TerminalSessionDTO[] } | null;
        if (!data || !Array.isArray(data.terminals)) return;
        setTerminals(sortSessions(data.terminals));
      });

      source.addEventListener('terminal', (event) => {
        const data = safeParse(event.data) as { terminal?: TerminalSessionDTO } | null;
        if (!data?.terminal) return;
        setTerminals((prev) => sortSessions(mergeSession(prev, data.terminal!)));
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
        connect();
      }, 1000);
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [config.baseUrl, config.token]);

  return { terminals, status };
}

function mergeSession(
  existing: TerminalSessionDTO[],
  incoming: TerminalSessionDTO
): TerminalSessionDTO[] {
  const map = new Map(existing.map((terminal) => [terminal.id, terminal]));
  map.set(incoming.id, incoming);
  return Array.from(map.values());
}

function sortSessions(terminals: TerminalSessionDTO[]) {
  return [...terminals].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
