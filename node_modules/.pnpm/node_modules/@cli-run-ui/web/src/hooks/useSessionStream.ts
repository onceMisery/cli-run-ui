import { useEffect, useState } from 'react';
import type { SessionDTO } from '@cli-run-ui/core';

export type StreamStatus = 'connecting' | 'open' | 'closed';

export function useSessionStream() {
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      source?.close();
      source = new EventSource('/api/sessions/stream');

      source.addEventListener('sessions', (event) => {
        const data = safeParse(event.data);
        if (!Array.isArray(data)) return;
        setSessions(normalizeSessions(data as SessionDTO[]));
      });

      source.addEventListener('sessionsUpdate', (event) => {
        const data = safeParse(event.data);
        if (!Array.isArray(data)) return;
        setSessions((prev) => mergeSessions(prev, data as SessionDTO[]));
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
  }, []);

  return { sessions, status };
}

function mergeSessions(existing: SessionDTO[], incoming: SessionDTO[]): SessionDTO[] {
  return normalizeSessions([...existing, ...incoming]);
}

function normalizeSessions(sessions: SessionDTO[]): SessionDTO[] {
  const map = new Map<string, SessionDTO>();
  for (const session of sessions) {
    const existing = map.get(session.uid);
    if (!existing || session.updatedAtMs >= existing.updatedAtMs) {
      map.set(session.uid, session);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
