import { useEffect, useState } from 'react';
import type { SessionDTO } from '@cli-run-ui/core';

export type StreamStatus = 'connecting' | 'open' | 'closed';

export function useSessionStream() {
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');

  useEffect(() => {
    const source = new EventSource('/api/sessions/stream');

    source.addEventListener('sessions', (event) => {
      const data = safeParse(event.data);
      if (!Array.isArray(data)) return;
      setSessions(data as SessionDTO[]);
    });

    source.addEventListener('sessionsUpdate', (event) => {
      const data = safeParse(event.data);
      if (!Array.isArray(data)) return;
      setSessions((prev) => mergeSessions(prev, data as SessionDTO[]));
    });

    source.onopen = () => setStatus('open');
    source.onerror = () => setStatus('closed');

    return () => {
      source.close();
    };
  }, []);

  return { sessions, status };
}

function mergeSessions(existing: SessionDTO[], incoming: SessionDTO[]): SessionDTO[] {
  const map = new Map(existing.map((session) => [session.uid, session]));
  for (const session of incoming) {
    map.set(session.uid, session);
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