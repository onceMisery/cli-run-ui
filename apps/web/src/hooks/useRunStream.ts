import { useEffect, useState } from 'react';
import type { RunLogEntryDTO, RunSessionDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useRunStream(runId: string | null, initialRun: RunSessionDTO | null) {
  const { config } = useApiConfig();
  const [run, setRun] = useState<RunSessionDTO | null>(initialRun);
  const [logs, setLogs] = useState<RunLogEntryDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>(runId ? 'connecting' : 'closed');

  useEffect(() => {
    setRun(initialRun);
  }, [initialRun]);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setLogs([]);
      setStatus('closed');
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      source?.close();
      source = apiEventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as {
          run?: RunSessionDTO;
          logs?: RunLogEntryDTO[];
        } | null;
        if (!data) return;
        if (data.run) setRun(data.run);
        if (Array.isArray(data.logs)) setLogs(data.logs);
      });

      source.addEventListener('run', (event) => {
        const data = safeParse(event.data) as { run?: RunSessionDTO } | null;
        if (data?.run) setRun(data.run);
      });

      source.addEventListener('log', (event) => {
        const data = safeParse(event.data) as { entry?: RunLogEntryDTO } | null;
        if (!data?.entry) return;
        setLogs((prev) => [...prev, data.entry!].slice(-800));
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

    setLogs([]);
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [config.baseUrl, config.token, runId]);

  return { run, logs, status };
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
