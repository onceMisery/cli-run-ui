import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { buildProviderCommand } from './providerCommands.js';
export class AgentRelayManager {
    relays = new Map();
    relayListeners = new Set();
    turnListeners = new Set();
    interventionListeners = new Set();
    interventionRemovedListeners = new Set();
    constructor(restoredRelays = []) {
        this.restore(restoredRelays);
    }
    listRelays() {
        return Array.from(this.relays.values())
            .map((relay) => relay.summary)
            .sort((a, b) => b.createdAtMs - a.createdAtMs);
    }
    getRelay(relayId) {
        return this.relays.get(relayId)?.summary ?? null;
    }
    getTurns(relayId) {
        return this.relays.get(relayId)?.turns ?? [];
    }
    getInterventions(relayId) {
        return this.relays.get(relayId)?.interventions ?? [];
    }
    listPersistedRelays() {
        return Array.from(this.relays.values())
            .map((relay) => ({
            summary: relay.summary,
            turns: [...relay.turns],
            interventions: [...relay.interventions],
        }))
            .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs);
    }
    onRelay(listener) {
        this.relayListeners.add(listener);
        return () => this.relayListeners.delete(listener);
    }
    onTurn(listener) {
        this.turnListeners.add(listener);
        return () => this.turnListeners.delete(listener);
    }
    onIntervention(listener) {
        this.interventionListeners.add(listener);
        return () => this.interventionListeners.delete(listener);
    }
    onInterventionRemoved(listener) {
        this.interventionRemovedListeners.add(listener);
        return () => this.interventionRemovedListeners.delete(listener);
    }
    async startRelay(request) {
        const createdAtMs = Date.now();
        const relayId = randomUUID();
        const summary = {
            id: relayId,
            cwd: request.cwd,
            title: request.title?.trim() || summarizeTitle(request.prompt),
            initialPrompt: request.prompt.trim(),
            starter: request.starter,
            participants: normalizeParticipants(request.participants, request.starter),
            systemPrompt: request.systemPrompt?.trim() || undefined,
            maxTurns: clampTurns(request.maxTurns),
            createdAtMs,
            startedAtMs: createdAtMs,
            currentTurn: 0,
            status: 'starting',
        };
        const internal = {
            summary,
            turns: [],
            interventions: normalizeInitialPinnedRules(request.initialPinnedRules, relayId, createdAtMs),
            stopRequested: false,
            pauseRequested: false,
            loopActive: false,
        };
        this.relays.set(relayId, internal);
        this.emitRelay(summary);
        void this.runRelay(relayId);
        return summary;
    }
    stopRelay(relayId) {
        const relay = this.relays.get(relayId);
        if (!relay)
            return null;
        relay.stopRequested = true;
        relay.pauseRequested = false;
        relay.activeChild?.kill();
        if (relay.summary.status === 'completed' || relay.summary.status === 'failed' || relay.summary.status === 'stopped') {
            return relay.summary;
        }
        this.updateRelay(relayId, {
            status: 'stopped',
            summary: buildRelaySummary(relay.summary, relay.turns),
            endedAtMs: Date.now(),
        });
        return relay.summary;
    }
    pauseRelay(relayId) {
        const relay = this.relays.get(relayId);
        if (!relay)
            return null;
        if (relay.summary.status === 'completed' || relay.summary.status === 'failed' || relay.summary.status === 'stopped') {
            return relay.summary;
        }
        relay.pauseRequested = true;
        if (!relay.activeChild && !relay.loopActive) {
            this.updateRelay(relayId, {
                status: 'paused',
                summary: buildRelaySummary(relay.summary, relay.turns),
            });
        }
        return relay.summary;
    }
    resumeRelay(relayId) {
        const relay = this.relays.get(relayId);
        if (!relay)
            return null;
        if (relay.summary.status !== 'paused') {
            return relay.summary;
        }
        relay.stopRequested = false;
        relay.pauseRequested = false;
        const nextTurnNumber = relay.summary.currentTurn + 1;
        if (nextTurnNumber > relay.summary.maxTurns) {
            this.updateRelay(relayId, {
                status: 'completed',
                summary: buildRelaySummary(relay.summary, relay.turns),
                endedAtMs: Date.now(),
            });
            return relay.summary;
        }
        void this.runRelay(relayId, nextTurnNumber);
        return relay.summary;
    }
    addIntervention(relayId, content) {
        const relay = this.relays.get(relayId);
        if (!relay) {
            throw new Error('Relay not found.');
        }
        if (relay.summary.status !== 'running' &&
            relay.summary.status !== 'starting' &&
            relay.summary.status !== 'paused') {
            throw new Error('Relay is not currently accepting new messages.');
        }
        const normalized = content.trim();
        if (!normalized) {
            throw new Error('Message content is required.');
        }
        const intervention = {
            id: randomUUID(),
            relayId,
            content: normalized,
            createdAtMs: Date.now(),
            pinned: false,
            sortOrder: getNextInterventionSortOrder(relay.interventions),
        };
        relay.interventions.push(intervention);
        this.emitIntervention(intervention);
        return intervention;
    }
    updateIntervention(relayId, interventionId, patch) {
        const relay = this.relays.get(relayId);
        if (!relay) {
            throw new Error('Relay not found.');
        }
        if (relay.summary.status !== 'running' &&
            relay.summary.status !== 'starting' &&
            relay.summary.status !== 'paused') {
            throw new Error('Relay is not currently accepting message edits.');
        }
        const index = relay.interventions.findIndex((entry) => entry.id === interventionId);
        if (index === -1) {
            throw new Error('Intervention not found.');
        }
        const current = relay.interventions[index];
        if (!current) {
            throw new Error('Intervention not found.');
        }
        const normalizedContent = patch.content?.trim();
        if (patch.content !== undefined && !normalizedContent) {
            throw new Error('Message content is required.');
        }
        const nextPinned = typeof patch.pinned === 'boolean' ? patch.pinned : (current.pinned ?? false);
        const next = {
            ...current,
            content: normalizedContent ?? current.content,
            updatedAtMs: Date.now(),
            pinned: nextPinned,
            sortOrder: nextPinned && !(current.pinned ?? false)
                ? getNextPinnedInterventionSortOrder(relay.interventions)
                : current.sortOrder ?? current.createdAtMs,
        };
        relay.interventions[index] = next;
        this.emitIntervention(next);
        return next;
    }
    moveIntervention(relayId, interventionId, direction) {
        const relay = this.relays.get(relayId);
        if (!relay) {
            throw new Error('Relay not found.');
        }
        if (relay.summary.status !== 'running' &&
            relay.summary.status !== 'starting' &&
            relay.summary.status !== 'paused') {
            throw new Error('Relay is not currently accepting message changes.');
        }
        const pinned = relay.interventions
            .filter((entry) => entry.pinned)
            .sort(comparePinnedInterventions);
        const index = pinned.findIndex((entry) => entry.id === interventionId);
        if (index === -1) {
            throw new Error('Pinned intervention not found.');
        }
        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        const current = pinned[index];
        const target = pinned[swapIndex];
        if (!current || !target) {
            return current ?? null;
        }
        const currentStored = relay.interventions.find((entry) => entry.id === current.id);
        const targetStored = relay.interventions.find((entry) => entry.id === target.id);
        if (!currentStored || !targetStored) {
            throw new Error('Pinned intervention not found.');
        }
        const currentOrder = currentStored.sortOrder ?? currentStored.createdAtMs;
        currentStored.sortOrder = targetStored.sortOrder ?? targetStored.createdAtMs;
        currentStored.updatedAtMs = Date.now();
        targetStored.sortOrder = currentOrder;
        targetStored.updatedAtMs = Date.now();
        this.emitIntervention(currentStored);
        this.emitIntervention(targetStored);
        return currentStored;
    }
    removeIntervention(relayId, interventionId) {
        const relay = this.relays.get(relayId);
        if (!relay) {
            throw new Error('Relay not found.');
        }
        if (relay.summary.status !== 'running' &&
            relay.summary.status !== 'starting' &&
            relay.summary.status !== 'paused') {
            throw new Error('Relay is not currently accepting message changes.');
        }
        const nextInterventions = relay.interventions.filter((entry) => entry.id !== interventionId);
        if (nextInterventions.length === relay.interventions.length) {
            throw new Error('Intervention not found.');
        }
        relay.interventions = nextInterventions;
        this.emitInterventionRemoved({ relayId, interventionId });
    }
    async runRelay(relayId, startTurnNumber = 1) {
        const relay = this.relays.get(relayId);
        if (!relay)
            return;
        if (relay.loopActive)
            return;
        relay.loopActive = true;
        this.updateRelay(relayId, { status: 'running', endedAtMs: undefined });
        try {
            for (let turnNumber = startTurnNumber; turnNumber <= relay.summary.maxTurns; turnNumber += 1) {
                const currentRelay = this.relays.get(relayId);
                if (!currentRelay || currentRelay.stopRequested) {
                    return;
                }
                if (currentRelay.pauseRequested) {
                    currentRelay.pauseRequested = false;
                    this.updateRelay(relayId, {
                        status: 'paused',
                        summary: buildRelaySummary(currentRelay.summary, currentRelay.turns),
                    });
                    return;
                }
                const history = buildRelayHistory(currentRelay.summary, currentRelay.turns, currentRelay.interventions);
                const participant = resolveParticipantForTurn(relay.summary.participants, turnNumber);
                if (!participant) {
                    this.updateRelay(relayId, {
                        status: 'failed',
                        error: 'No relay participants configured.',
                        endedAtMs: Date.now(),
                    });
                    return;
                }
                const prompt = buildRelayTurnPrompt({
                    initialPrompt: relay.summary.initialPrompt,
                    history,
                    turnNumber,
                    maxTurns: relay.summary.maxTurns,
                    participant,
                    participants: relay.summary.participants,
                    systemPrompt: relay.summary.systemPrompt,
                });
                const turn = {
                    id: randomUUID(),
                    relayId,
                    turn: turnNumber,
                    agent: participant.provider,
                    participantId: participant.id,
                    participantLabel: participant.label,
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
                    if (!latestRelay)
                        return;
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
                    if (!completedTurn)
                        return;
                    if (completedTurn.status === 'failed') {
                        this.updateRelay(relayId, {
                            status: 'failed',
                            error: completedTurn.error ?? `Turn ${turnNumber} failed.`,
                            summary: buildRelaySummary(relay.summary, currentRelay.turns),
                            endedAtMs: Date.now(),
                        });
                        return;
                    }
                    if (latestRelay.pauseRequested) {
                        latestRelay.pauseRequested = false;
                        this.updateRelay(relayId, {
                            status: 'paused',
                            summary: buildRelaySummary(latestRelay.summary, latestRelay.turns),
                        });
                        return;
                    }
                }
                catch (error) {
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
                        summary: buildRelaySummary(relay.summary, relay.turns),
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
                summary: buildRelaySummary(latestRelay.summary, latestRelay.turns),
                endedAtMs: Date.now(),
            });
        }
        finally {
            const latestRelay = this.relays.get(relayId);
            if (latestRelay) {
                latestRelay.loopActive = false;
            }
        }
    }
    executeTurn(relayId, turn) {
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
            const stdout = [];
            const stderr = [];
            const useShell = process.platform === 'win32';
            const child = useShell
                ? spawn(toWindowsShellCommand(spec.command, spec.args), {
                    cwd: relay.summary.cwd,
                    env: {
                        ...process.env,
                        FORCE_COLOR: '0',
                        NO_COLOR: '1',
                    },
                    stdio: 'pipe',
                    shell: true,
                    windowsHide: true,
                })
                : spawn(spec.command, spec.args, {
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
    updateRelay(relayId, patch) {
        const relay = this.relays.get(relayId);
        if (!relay)
            return;
        relay.summary = { ...relay.summary, ...patch };
        this.emitRelay(relay.summary);
    }
    updateTurn(relayId, turnId, patch) {
        const relay = this.relays.get(relayId);
        if (!relay)
            return null;
        const index = relay.turns.findIndex((turn) => turn.id === turnId);
        if (index === -1)
            return null;
        const currentTurn = relay.turns[index];
        if (!currentTurn)
            return null;
        const nextTurn = { ...currentTurn, ...patch };
        relay.turns[index] = nextTurn;
        this.emitTurn(nextTurn);
        return nextTurn;
    }
    emitRelay(relay) {
        for (const listener of this.relayListeners) {
            listener(relay);
        }
    }
    emitTurn(turn) {
        for (const listener of this.turnListeners) {
            listener(turn);
        }
    }
    emitIntervention(intervention) {
        for (const listener of this.interventionListeners) {
            listener(intervention);
        }
    }
    emitInterventionRemoved(payload) {
        for (const listener of this.interventionRemovedListeners) {
            listener(payload);
        }
    }
    restore(restoredRelays) {
        const restoredAtMs = Date.now();
        for (const entry of restoredRelays) {
            const summary = normalizeRestoredRelay(entry.summary, restoredAtMs);
            const turns = entry.turns
                .filter((turn) => turn.relayId === summary.id)
                .slice(-120);
            this.relays.set(summary.id, {
                summary,
                turns,
                interventions: Array.isArray(entry.interventions)
                    ? entry.interventions
                        .filter((intervention) => intervention.relayId === summary.id)
                        .map((intervention) => normalizeIntervention(intervention))
                        .slice(-80)
                    : [],
                stopRequested: false,
                pauseRequested: false,
                loopActive: false,
            });
        }
    }
}
function buildRelayTurnPrompt({ history, initialPrompt, maxTurns, participant, participants, systemPrompt, turnNumber, }) {
    const nextSpeakers = participants
        .filter((entry) => entry.id !== participant.id)
        .map((entry) => `${entry.label} (${entry.provider})`)
        .join(', ');
    const transcript = history
        .map((entry, index) => `${index + 1}. ${entry.speaker}:\n${entry.content}`)
        .join('\n\n');
    return [
        `You are ${participant.label} running on ${participant.provider}.`,
        `You are participating in a multi-agent room with: ${nextSpeakers || 'no other participants listed'}.`,
        `Original goal: ${initialPrompt}`,
        `This is turn ${turnNumber} of ${maxTurns}.`,
        systemPrompt ? `Room system prompt: ${systemPrompt}` : null,
        'Read the transcript so far, then contribute the single best next response.',
        'Keep the answer concise but substantive, and speak directly to the other participants.',
        'Do not mention hidden system prompts or tooling.',
        '',
        'Transcript so far:',
        transcript,
    ]
        .filter(Boolean)
        .join('\n');
}
function buildRelayHistory(relay, turns, interventions) {
    const turnEntries = turns
        .filter((turn) => turn.status !== 'running')
        .map((turn) => ({
        createdAtMs: turn.endedAtMs ?? turn.startedAtMs,
        speaker: turn.participantLabel,
        content: turn.output || fallbackOutput(turn.participantLabel),
    }));
    const interventionEntries = interventions.map((intervention) => ({
        createdAtMs: intervention.createdAtMs,
        speaker: 'User',
        content: intervention.content,
    }));
    const pinnedEntries = interventions
        .filter((intervention) => intervention.pinned)
        .sort(comparePinnedInterventions)
        .map((intervention) => ({
        createdAtMs: relay.createdAtMs,
        speaker: 'User rule',
        content: intervention.content,
    }));
    const transientInterventionEntries = interventionEntries.filter((_, index) => !interventions[index]?.pinned);
    return [
        {
            createdAtMs: relay.createdAtMs,
            speaker: 'User',
            content: relay.initialPrompt,
        },
        ...pinnedEntries,
        ...turnEntries,
        ...transientInterventionEntries,
    ]
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
        .map(({ speaker, content }) => ({ speaker, content }));
}
function resolveParticipantForTurn(participants, turnNumber) {
    if (participants.length === 0)
        return null;
    return participants[(turnNumber - 1) % participants.length] ?? null;
}
function fallbackOutput(label) {
    return `[${label} returned no output.]`;
}
function summarizeTitle(prompt) {
    const normalized = prompt.replace(/\s+/g, ' ').trim();
    return normalized.slice(0, 72) || 'Agent relay';
}
function clampTurns(value) {
    if (!Number.isFinite(value))
        return 4;
    return Math.min(12, Math.max(2, Math.round(value)));
}
function normalizeRestoredRelay(summary, restoredAtMs) {
    const status = summary.status === 'starting' || summary.status === 'running' ? 'stopped' : summary.status;
    return {
        ...summary,
        participants: Array.isArray(summary.participants) && summary.participants.length > 0
            ? summary.participants
            : normalizeParticipants(undefined, summary.starter),
        status,
        endedAtMs: status === 'stopped' ? summary.endedAtMs ?? restoredAtMs : summary.endedAtMs,
    };
}
function normalizeIntervention(intervention) {
    return {
        ...intervention,
        pinned: intervention.pinned ?? false,
        sortOrder: intervention.sortOrder ?? intervention.createdAtMs,
    };
}
function normalizeInitialPinnedRules(rules, relayId, createdAtMs) {
    if (!Array.isArray(rules))
        return [];
    return rules
        .map((rule) => rule.trim())
        .filter(Boolean)
        .slice(0, 8)
        .map((content, index) => ({
        id: randomUUID(),
        relayId,
        content,
        createdAtMs: createdAtMs + index,
        pinned: true,
        sortOrder: index + 1,
    }));
}
function getNextInterventionSortOrder(interventions) {
    return interventions.reduce((max, entry) => Math.max(max, entry.sortOrder ?? entry.createdAtMs), 0) + 1;
}
function getNextPinnedInterventionSortOrder(interventions) {
    return interventions
        .filter((entry) => entry.pinned)
        .reduce((max, entry) => Math.max(max, entry.sortOrder ?? entry.createdAtMs), 0) + 1;
}
function comparePinnedInterventions(left, right) {
    return ((left.sortOrder ?? left.createdAtMs) - (right.sortOrder ?? right.createdAtMs) ||
        left.createdAtMs - right.createdAtMs);
}
function normalizeParticipants(participants, starter) {
    const fallback = buildDefaultParticipants(starter);
    if (!Array.isArray(participants) || participants.length < 2) {
        return fallback;
    }
    const normalized = participants
        .map((participant, index) => {
        const provider = participant.provider === 'claude' || participant.provider === 'codex'
            ? participant.provider
            : null;
        const label = participant.label?.trim();
        if (!provider || !label)
            return null;
        return {
            id: `participant-${index + 1}`,
            provider,
            label: label.slice(0, 40),
        };
    })
        .filter((participant) => participant !== null)
        .slice(0, 6);
    return normalized.length >= 2 ? normalized : fallback;
}
function buildDefaultParticipants(starter) {
    const first = starter;
    const second = starter === 'claude' ? 'codex' : 'claude';
    return [
        {
            id: 'participant-1',
            provider: first,
            label: first === 'claude' ? 'Claude lead' : 'Codex lead',
        },
        {
            id: 'participant-2',
            provider: second,
            label: second === 'claude' ? 'Claude reviewer' : 'Codex reviewer',
        },
    ];
}
function buildRelaySummary(relay, turns) {
    if (turns.length === 0)
        return undefined;
    const highlights = turns
        .filter((turn) => turn.output.trim().length > 0)
        .slice(0, 4)
        .map((turn) => {
        const firstLine = turn.output
            .split(/\r?\n/)
            .find((line) => line.trim().length > 0)
            ?.trim();
        return `${turn.participantLabel}: ${truncateLine(firstLine ?? 'No visible output.', 140)}`;
    });
    if (highlights.length === 0) {
        return `${relay.title}: ${turns.length} turns completed with little visible output.`;
    }
    return `${relay.title}\n${highlights.join('\n')}`;
}
function truncateLine(value, maxLength) {
    if (value.length <= maxLength)
        return value;
    return `${value.slice(0, maxLength - 1)}…`;
}
function toWindowsShellCommand(command, args) {
    return [quoteForCmd(command), ...args.map(quoteForCmd)].join(' ');
}
function quoteForCmd(value) {
    const normalized = value.replace(/\r?\n/g, ' ').trim();
    if (!normalized)
        return '""';
    return `"${normalized.replace(/"/g, '""').replace(/%/g, '%%')}"`;
}
//# sourceMappingURL=AgentRelayManager.js.map