import { useEffect, useState } from 'react';
import type { AgentTaskDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';
import { apiEventSource, useApiConfig } from '@/lib/api';

export function useTaskSessions() {
  const { config } = useApiConfig();
  const [tasks, setTasks] = useState<AgentTaskDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      source?.close();
      source = apiEventSource('/api/tasks/stream');

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as { tasks?: AgentTaskDTO[] } | null;
        if (!data || !Array.isArray(data.tasks)) return;
        setTasks(sortTasks(data.tasks));
      });

      source.addEventListener('task', (event) => {
        const data = safeParse(event.data) as { task?: AgentTaskDTO } | null;
        if (!data?.task) return;
        setTasks((prev) => sortTasks(mergeTask(prev, data.task)));
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

  return { tasks, status };
}

function mergeTask(existing: AgentTaskDTO[], incoming: AgentTaskDTO): AgentTaskDTO[] {
  const map = new Map(existing.map((task) => [task.id, task]));
  map.set(incoming.id, incoming);
  return Array.from(map.values());
}

function sortTasks(tasks: AgentTaskDTO[]) {
  return [...tasks].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
