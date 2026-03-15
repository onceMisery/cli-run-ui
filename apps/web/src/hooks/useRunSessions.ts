import { useEffect, useState } from 'react';
import type { RunSessionDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useRunSessions() {
  const { config } = useApiConfig();
  const [runs, setRuns] = useState<RunSessionDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      source?.close();
      source = apiEventSource('/api/runs/stream');

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as { runs?: RunSessionDTO[] } | null;
        if (!data || !Array.isArray(data.runs)) return;
        setRuns(sortRuns(data.runs));
      });

      source.addEventListener('run', (event) => {
        const data = safeParse(event.data) as { run?: RunSessionDTO } | null;
        if (!data?.run) return;
        setRuns((prev) => sortRuns(mergeRun(prev, data.run!)));
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

  return { runs, status };
}

function mergeRun(existing: RunSessionDTO[], incoming: RunSessionDTO): RunSessionDTO[] {
  const map = new Map(existing.map((run) => [run.id, run]));
  map.set(incoming.id, incoming);
  return Array.from(map.values());
}

function sortRuns(runs: RunSessionDTO[]) {
  return [...runs].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
