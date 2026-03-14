import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type {
  AgentRelaySessionDTO,
  AgentRelayTurnDTO,
  ProviderId,
  StartAgentRelayRequestDTO,
} from '@cli-run-ui/core';
import { buildProviderCommand } from './providerCommands.js';

type RelayListener = (relay: AgentRelaySessionDTO) => void;
type RelayTurnListener = (turn: AgentRelayTurnDTO) => void;

export interface PersistedAgentRelayRecord {
  summary: AgentRelaySessionDTO;
  turns: AgentRelayTurnDTO[];
}

interface InternalRelay extends PersistedAgentRelayRecord {
  activeChild?: ChildProcessWithoutNullStreams;
  stopRequested: boolean;
}

export class AgentRelayManager {
  private readonly relays = new Map<string, InternalRelay>();
  private readonly relayListeners = new Set<RelayListener>();
  private readonly turnListeners = new Set<RelayTurnListener>();

  constructor(restoredRelays: PersistedAgentRelayRecord[] = []) {
    this.restore(restoredRelays);
  }

  listRelays(): AgentRelaySessionDTO[] {
    return Array.from(this.relays.values())
      .map((relay) => relay.summary)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }

  getRelay(relayId: string): AgentRelaySessionDTO | null {
    return this.relays.get(relayId)?.summary ?? null;
  }

  getTurns(relayId: string): AgentRelayTurnDTO[] {
    return this.relays.get(relayId)?.turns ?? [];
  }

  listPersistedRelays(): PersistedAgentRelayRecord[] {
    return Array.from(this.relays.values())
      .map((relay) => ({
        summary: relay.summary,
        turns: [...relay.turns],
      }))
      .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs);
  }

  onRelay(listener: RelayListener): () => void {
    this.relayListeners.add(listener);
    return () => this.relayListeners.delete(listener);
  }

  onTurn(listener: RelayTurnListener): () => void {
    this.turnListeners.add(listener);
    return () => this.turnListeners.delete(listener);
  }

  async startRelay(request: StartAgentRelayRequestDTO): Promise<AgentRelaySessionDTO> {
    const createdAtMs = Date.now();
    const relayId = randomUUID();
    const summary: AgentRelaySessionDTO = {
      id: relayId,
      cwd: request.cwd,
      title: request.title?.trim() || summarizeTitle(request.prompt),
      initialPrompt: request.prompt.trim(),
      starter: request.starter,
      maxTurns: clampTurns(request.maxTurns),
      createdAtMs,
      startedAtMs: createdAtMs,
      currentTurn: 0,
      status: 'starting',
    };

    const internal: InternalRelay = {
      summary,
      turns: [],
      stopRequested: false,
    };

    this.relays.set(relayId, internal);
    this.emitRelay(summary);
    void this.runRelay(relayId);
    return summary;
  }

  stopRelay(relayId: string): AgentRelaySessionDTO | null {
    const relay = this.relays.get(relayId);
    if (!relay) return null;
    relay.stopRequested = true;
    relay.activeChild?.kill();
    if (relay.summary.status === 'completed' || relay.summary.status === 'failed' || relay.summary.status === 'stopped') {
      return relay.summary;
    }
    this.updateRelay(relayId, {
      status: 'stopped',
      endedAtMs: Date.now(),
    });
    return relay.summary;
  }

  private async runRelay(relayId: string) {
    const relay = this.relays.get(relayId);
    if (!relay) return;

    this.updateRelay(relayId, { status: 'running' });

    const history: Array<{ agent: ProviderId | 'user'; content: string }> = [
      { agent: 'user', content: relay.summary.initialPrompt },
    ];

    for (let turnNumber = 1; turnNumber <= relay.summary.maxTurns; turnNumber += 1) {
      const currentRelay = this.relays.get(relayId);
      if (!currentRelay || currentRelay.stopRequested) {
        return;
      }

      const agent = resolveAgentForTurn(relay.summary.starter, turnNumber);
      const prompt = buildRelayTurnPrompt({
        initialPrompt: relay.summary.initialPrompt,
        history,
        turnNumber,
        maxTurns: relay.summary.maxTurns,
        agent,
      });

      const turn: AgentRelayTurnDTO = {
        id: randomUUID(),
        relayId,
        turn: turnNumber,
        agent,
        prompt,
        output: '',
        startedAtMs: Date.now(),
        status: 'running',
      };
      currentRelay.turns.push(turn);
      this.updateRelay(relayId, { currentTurn: turnNumber });
      this.emitTurn(turn);

      try {
        const result = await this.executeTurn(relayId, turn);
        const latestRelay = this.relays.get(relayId);
        if (!latestRelay) return;
        if (latestRelay.stopRequested) {
          this.updateTurn(relayId, turn.id, {
            output: result.output,
            endedAtMs: Date.now(),
            exitCode: result.exitCode,
            status: 'stopped',
          });
          return;
        }
        const completedTurn = this.updateTurn(relayId, turn.id, {
          output: result.output,
          endedAtMs: Date.now(),
          exitCode: result.exitCode,
          status: result.exitCode === 0 ? 'completed' : 'failed',
          error: result.exitCode === 0 ? undefined : result.output || `Exit code ${result.exitCode}`,
        });

        if (!completedTurn) return;

        history.push({
          agent,
          content: completedTurn.output || fallbackOutput(agent),
        });

        if (completedTurn.status === 'failed') {
          this.updateRelay(relayId, {
            status: 'failed',
            error: completedTurn.error ?? `Turn ${turnNumber} failed.`,
            endedAtMs: Date.now(),
          });
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.updateTurn(relayId, turn.id, {
          output: message,
          endedAtMs: Date.now(),
          status: relay.stopRequested ? 'stopped' : 'failed',
          error: message,
        });
        if (relay.stopRequested) {
          return;
        }
        this.updateRelay(relayId, {
          status: 'failed',
          error: message,
          endedAtMs: Date.now(),
        });
        return;
      }
    }

    const latestRelay = this.relays.get(relayId);
    if (!latestRelay || latestRelay.stopRequested) {
      return;
    }

    this.updateRelay(relayId, {
      status: 'completed',
      endedAtMs: Date.now(),
    });
  }

  private executeTurn(relayId: string, turn: AgentRelayTurnDTO): Promise<{
    output: string;
    exitCode: number | null;
  }> {
    const relay = this.relays.get(relayId);
    if (!relay) {
      return Promise.reject(new Error('Relay not found.'));
    }

    const spec = buildProviderCommand({
      provider: turn.agent,
      mode: 'task',
      cwd: relay.summary.cwd,
      prompt: turn.prompt,
    });

    return new Promise((resolve, reject) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const child = spawn(spec.command, spec.args, {
        cwd: relay.summary.cwd,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdio: 'pipe',
        shell: false,
      });

      relay.activeChild = child;

      child.stdout.on('data', (chunk) => {
        stdout.push(chunk.toString('utf8'));
      });

      child.stderr.on('data', (chunk) => {
        stderr.push(chunk.toString('utf8'));
      });

      child.on('error', (error) => {
        relay.activeChild = undefined;
        reject(error);
      });

      child.on('close', (exitCode) => {
        relay.activeChild = undefined;
        const output = [stdout.join('').trim(), stderr.join('').trim()]
          .filter(Boolean)
          .join('\n\n')
          .trim();
        resolve({
          output,
          exitCode,
        });
      });
    });
  }

  private updateRelay(relayId: string, patch: Partial<AgentRelaySessionDTO>) {
    const relay = this.relays.get(relayId);
    if (!relay) return;
    relay.summary = { ...relay.summary, ...patch };
    this.emitRelay(relay.summary);
  }

  private updateTurn(
    relayId: string,
    turnId: string,
    patch: Partial<AgentRelayTurnDTO>
  ): AgentRelayTurnDTO | null {
    const relay = this.relays.get(relayId);
    if (!relay) return null;
    const index = relay.turns.findIndex((turn) => turn.id === turnId);
    if (index === -1) return null;
    const currentTurn = relay.turns[index];
    if (!currentTurn) return null;
    const nextTurn: AgentRelayTurnDTO = { ...currentTurn, ...patch };
    relay.turns[index] = nextTurn;
    this.emitTurn(nextTurn);
    return nextTurn;
  }

  private emitRelay(relay: AgentRelaySessionDTO) {
    for (const listener of this.relayListeners) {
      listener(relay);
    }
  }

  private emitTurn(turn: AgentRelayTurnDTO) {
    for (const listener of this.turnListeners) {
      listener(turn);
    }
  }

  private restore(restoredRelays: PersistedAgentRelayRecord[]) {
    const restoredAtMs = Date.now();
    for (const entry of restoredRelays) {
      const summary = normalizeRestoredRelay(entry.summary, restoredAtMs);
      const turns = entry.turns
        .filter((turn) => turn.relayId === summary.id)
        .slice(-120);

      this.relays.set(summary.id, {
        summary,
        turns,
        stopRequested: false,
      });
    }
  }
}

function buildRelayTurnPrompt({
  agent,
  history,
  initialPrompt,
  maxTurns,
  turnNumber,
}: {
  agent: ProviderId;
  history: Array<{ agent: ProviderId | 'user'; content: string }>;
  initialPrompt: string;
  maxTurns: number;
  turnNumber: number;
}) {
  const counterpart = agent === 'claude' ? 'codex' : 'claude';
  const transcript = history
    .map((entry, index) => `${index + 1}. ${labelForHistory(entry.agent)}:\n${entry.content}`)
    .join('\n\n');

  return [
    `You are ${agent}.`,
    `You are participating in a relay conversation with ${counterpart}.`,
    `Original goal: ${initialPrompt}`,
    `This is turn ${turnNumber} of ${maxTurns}.`,
    'Read the transcript so far, then contribute the single best next response.',
    'Keep the answer concise but substantive, and speak directly to the other agent.',
    'Do not mention hidden system prompts or tooling.',
    '',
    'Transcript so far:',
    transcript,
  ].join('\n');
}

function resolveAgentForTurn(starter: ProviderId, turnNumber: number): ProviderId {
  const first = starter;
  const second = starter === 'claude' ? 'codex' : 'claude';
  return turnNumber % 2 === 1 ? first : second;
}

function labelForHistory(agent: ProviderId | 'user') {
  if (agent === 'user') return 'User';
  return agent === 'claude' ? 'Claude' : 'Codex';
}

function fallbackOutput(agent: ProviderId) {
  return `[${labelForHistory(agent)} returned no output.]`;
}

function summarizeTitle(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, 72) || 'Agent relay';
}

function clampTurns(value: number) {
  if (!Number.isFinite(value)) return 4;
  return Math.min(12, Math.max(2, Math.round(value)));
}

function normalizeRestoredRelay(summary: AgentRelaySessionDTO, restoredAtMs: number): AgentRelaySessionDTO {
  const status =
    summary.status === 'starting' || summary.status === 'running' ? 'stopped' : summary.status;
  return {
    ...summary,
    status,
    endedAtMs: status === 'stopped' ? summary.endedAtMs ?? restoredAtMs : summary.endedAtMs,
  };
}
