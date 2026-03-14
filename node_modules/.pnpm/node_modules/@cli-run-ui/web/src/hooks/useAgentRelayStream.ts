import { useEffect, useState } from 'react';
import type { AgentRelaySessionDTO, AgentRelayTurnDTO } from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';

export function useAgentRelayStream(
  relayId: string | null,
  initialRelay: AgentRelaySessionDTO | null
) {
  const [relay, setRelay] = useState<AgentRelaySessionDTO | null>(initialRelay);
  const [turns, setTurns] = useState<AgentRelayTurnDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>(relayId ? 'connecting' : 'closed');

  useEffect(() => {
    setRelay(initialRelay);
  }, [initialRelay]);

  useEffect(() => {
    if (!relayId) {
      setRelay(null);
      setTurns([]);
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
      source = new EventSource(`/api/relays/${encodeURIComponent(relayId)}/stream`);

      source.addEventListener('snapshot', (event) => {
        const data = safeParse(event.data) as {
          relay?: AgentRelaySessionDTO;
          turns?: AgentRelayTurnDTO[];
        } | null;
        if (!data) return;
        if (data.relay) setRelay(data.relay);
        if (Array.isArray(data.turns)) setTurns(sortTurns(data.turns));
      });

      source.addEventListener('relay', (event) => {
        const data = safeParse(event.data) as { relay?: AgentRelaySessionDTO } | null;
        if (data?.relay) setRelay(data.relay);
      });

      source.addEventListener('turn', (event) => {
        const data = safeParse(event.data) as { turn?: AgentRelayTurnDTO } | null;
        if (!data?.turn) return;
        setTurns((prev) => sortTurns(mergeTurn(prev, data.turn)));
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

    setTurns([]);
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [relayId]);

  return { relay, turns, status };
}

function mergeTurn(existing: AgentRelayTurnDTO[], incoming: AgentRelayTurnDTO) {
  const map = new Map(existing.map((turn) => [turn.id, turn]));
  map.set(incoming.id, incoming);
  return Array.from(map.values());
}

function sortTurns(turns: AgentRelayTurnDTO[]) {
  return [...turns].sort((a, b) => a.turn - b.turn);
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
