import { useEffect, useState } from 'react';
import type { TerminalOutputDTO, TerminalSessionDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useTerminalStream(
  terminalId: string | null,
  initialTerminal: TerminalSessionDTO | null
) {
  const { config } = useApiConfig();
  const [terminal, setTerminal] = useState<TerminalSessionDTO | null>(initialTerminal);
  const [outputs, setOutputs] = useState<TerminalOutputDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>(terminalId ? 'connecting' : 'closed');

  useEffect(() => {
    setTerminal(initialTerminal);
  }, [initialTerminal]);

  useEffect(() => {
    if (!terminalId) {
      setTerminal(null);
      setOutputs([]);
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
      source = apiEventSource(`/api/terminals/${encodeURIComponent(terminalId)}/stream`);

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as {
          terminal?: TerminalSessionDTO;
          outputs?: TerminalOutputDTO[];
        } | null;
        if (!data) return;
        if (data.terminal) setTerminal(data.terminal);
        if (Array.isArray(data.outputs)) setOutputs(data.outputs);
      });

      source.addEventListener('terminal', (event) => {
        const data = safeParse(event.data) as { terminal?: TerminalSessionDTO } | null;
        if (data?.terminal) setTerminal(data.terminal);
      });

      source.addEventListener('output', (event) => {
        const data = safeParse(event.data) as { output?: TerminalOutputDTO } | null;
        if (!data?.output) return;
        setOutputs((prev) => [...prev, data.output!].slice(-2000));
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

    setOutputs([]);
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [config.baseUrl, config.token, terminalId]);

  return { terminal, outputs, status };
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
