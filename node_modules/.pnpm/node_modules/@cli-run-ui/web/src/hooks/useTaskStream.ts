import { useEffect, useState } from 'react';
import type { AgentTaskDTO, AgentTaskEventDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useTaskStream(taskId: string | null, initialTask: AgentTaskDTO | null) {
  const { config } = useApiConfig();
  const [task, setTask] = useState<AgentTaskDTO | null>(initialTask);
  const [events, setEvents] = useState<AgentTaskEventDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>(taskId ? 'connecting' : 'closed');

  useEffect(() => {
    setTask(initialTask);
  }, [initialTask]);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setEvents([]);
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
      source = apiEventSource(`/api/tasks/${encodeURIComponent(taskId)}/stream`);

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as {
          task?: AgentTaskDTO;
          events?: AgentTaskEventDTO[];
        } | null;
        if (!data) return;
        if (data.task) setTask(data.task);
        if (Array.isArray(data.events)) setEvents(data.events);
      });

      source.addEventListener('task', (event) => {
        const data = safeParse(event.data) as { task?: AgentTaskDTO } | null;
        if (data?.task) setTask(data.task);
      });

      source.addEventListener('event', (event) => {
        const data = safeParse(event.data) as { event?: AgentTaskEventDTO } | null;
        if (!data?.event) return;
        setEvents((prev) => [...prev, data.event!].slice(-240));
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

    setEvents([]);
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [config.baseUrl, config.token, taskId]);

  return { task, events, status };
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
