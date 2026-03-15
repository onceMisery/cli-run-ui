import { useEffect, useState } from 'react';
import type { AgentRelaySessionDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useAgentRelaySessions() {
  const { config } = useApiConfig();
  const [relays, setRelays] = useState<AgentRelaySessionDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      source?.close();
      source = apiEventSource('/api/relays/stream');

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as { relays?: AgentRelaySessionDTO[] } | null;
        if (!data || !Array.isArray(data.relays)) return;
        setRelays(sortRelays(data.relays));
      });

      source.addEventListener('relay', (event) => {
        const data = safeParse(event.data) as { relay?: AgentRelaySessionDTO } | null;
        if (!data?.relay) return;
        setRelays((prev) => sortRelays(mergeRelay(prev, data.relay)));
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

  return { relays, status };
}

function mergeRelay(existing: AgentRelaySessionDTO[], incoming: AgentRelaySessionDTO) {
  const map = new Map(existing.map((relay) => [relay.id, relay]));
  map.set(incoming.id, incoming);
  return Array.from(map.values());
}

function sortRelays(relays: AgentRelaySessionDTO[]) {
  return [...relays].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
