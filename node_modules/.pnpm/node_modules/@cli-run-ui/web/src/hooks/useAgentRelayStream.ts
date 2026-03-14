import { useEffect, useState } from 'react';
import type {
  AgentRelayInterventionDTO,
  RemoveAgentRelayInterventionDTO,
  AgentRelaySessionDTO,
  AgentRelayTurnDTO,
} from '@cli-run-ui/core';

import type { StreamStatus } from './useSessionStream.ts';

export function useAgentRelayStream(
  relayId: string | null,
  initialRelay: AgentRelaySessionDTO | null
) {
  const [relay, setRelay] = useState<AgentRelaySessionDTO | null>(initialRelay);
  const [turns, setTurns] = useState<AgentRelayTurnDTO[]>([]);
  const [interventions, setInterventions] = useState<AgentRelayInterventionDTO[]>([]);
  const [status, setStatus] = useState<StreamStatus>(relayId ? 'connecting' : 'closed');

  useEffect(() => {
    setRelay(initialRelay);
  }, [initialRelay]);

  useEffect(() => {
    if (!relayId) {
      setRelay(null);
      setTurns([]);
      setInterventions([]);
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
          interventions?: AgentRelayInterventionDTO[];
        } | null;
        if (!data) return;
        if (data.relay) setRelay(data.relay);
        if (Array.isArray(data.turns)) setTurns(sortTurns(data.turns));
        if (Array.isArray(data.interventions)) {
          setInterventions(sortInterventions(data.interventions));
        }
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

      source.addEventListener('intervention', (event) => {
        const data = safeParse(event.data) as { intervention?: AgentRelayInterventionDTO } | null;
        if (!data?.intervention) return;
        setInterventions((prev) => sortInterventions(mergeIntervention(prev, data.intervention)));
      });

      source.addEventListener('intervention_removed', (event) => {
        const data = safeParse(event.data) as { removal?: RemoveAgentRelayInterventionDTO } | null;
        if (!data?.removal) return;
        setInterventions((prev) =>
          prev.filter((entry) => entry.id !== data.removal?.interventionId)
        );
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
    setInterventions([]);
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [relayId]);

  return { relay, turns, interventions, status };
}

function mergeTurn(existing: AgentRelayTurnDTO[], incoming: AgentRelayTurnDTO) {
  const map = new Map(existing.map((turn) => [turn.id, turn]));
  map.set(incoming.id, incoming);
  return Array.from(map.values());
}

function sortTurns(turns: AgentRelayTurnDTO[]) {
  return [...turns].sort((a, b) => a.turn - b.turn);
}

function mergeIntervention(
  existing: AgentRelayInterventionDTO[],
  incoming: AgentRelayInterventionDTO
) {
  const map = new Map(existing.map((entry) => [entry.id, entry]));
  map.set(incoming.id, incoming);
  return Array.from(map.values());
}

function sortInterventions(interventions: AgentRelayInterventionDTO[]) {
  return [...interventions].sort((a, b) => a.createdAtMs - b.createdAtMs);
}

function safeParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
