import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ClaudeProvider, CodexProvider, WatcherHub, } from '@cli-run-ui/core';
import { AgentRelayManager } from './AgentRelayManager.js';
import { HistoryStore } from './HistoryStore.js';
import { RunManager } from './RunManager.js';
import { TerminalManager } from './TerminalManager.js';
const app = new Hono();
const providers = [new ClaudeProvider(), new CodexProvider()];
const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
const watcherHub = new WatcherHub(providers);
const historyStore = new HistoryStore();
const historySnapshot = await historyStore.load();
const runManager = new RunManager(historySnapshot.runs);
const terminalManager = new TerminalManager(historySnapshot.terminals);
const relayManager = new AgentRelayManager(historySnapshot.relays);
const runtimePersistence = createRuntimePersistenceTask(historyStore, runManager, terminalManager, relayManager);
watcherHub.start();
void listAllSessions();
runtimePersistence.schedule();
runManager.onRun(() => runtimePersistence.schedule());
runManager.onLog(() => runtimePersistence.schedule());
terminalManager.onSession(() => runtimePersistence.schedule());
terminalManager.onOutput(() => runtimePersistence.schedule());
relayManager.onRelay(() => runtimePersistence.schedule());
relayManager.onTurn(() => runtimePersistence.schedule());
const devOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
]);
const enableCors = process.env.NODE_ENV !== 'production';
if (enableCors) {
    app.use('/api/*', cors({
        origin: (origin) => {
            if (!origin)
                return null;
            return devOrigins.has(origin) ? origin : null;
        },
        allowMethods: ['GET', 'POST'],
        allowHeaders: ['Content-Type', 'X-Auth-Token'],
    }));
}
const authToken = process.env.CLI_RUN_UI_TOKEN;
if (authToken) {
    app.use('/api/*', async (c, next) => {
        const token = c.req.header('x-auth-token');
        if (token !== authToken) {
            return c.json({ error: 'unauthorized' }, 401);
        }
        await next();
    });
}
app.get('/api/sessions', async (c) => {
    const sessions = await listAllSessions();
    return c.json({ sessions });
});
app.get('/api/sessions/stream', (c) => {
    return createSseResponse(c, async (stream) => {
        const sessions = await listAllSessions();
        stream.send('sessions', sessions);
        const offSessions = watcherHub.onSessionsChanged(async () => {
            const updated = await listAllSessions();
            stream.send('sessionsUpdate', updated);
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offSessions();
            clearInterval(heartbeat);
        };
    });
});
app.get('/api/conversation/:uid/stream', (c) => {
    const uid = c.req.param('uid');
    const offsetParam = c.req.query('offset');
    const fromOffset = offsetParam ? Number(offsetParam) : 0;
    const [providerId, sessionId] = uid.split(':');
    const provider = providerMap.get(providerId);
    if (!provider || !sessionId) {
        return c.json({ error: 'invalid session uid' }, 400);
    }
    return createSseResponse(c, async (stream) => {
        let nextOffset = Number.isFinite(fromOffset) ? fromOffset : 0;
        const chunk = await provider.getConversationStream(sessionId, nextOffset);
        nextOffset = chunk.nextOffset;
        stream.send('messages', { messages: chunk.messages, nextOffset });
        const offConversation = watcherHub.onConversationAppended(async (sessionUid) => {
            if (sessionUid !== uid)
                return;
            const delta = await provider.getConversationStream(sessionId, nextOffset);
            if (delta.messages.length === 0)
                return;
            nextOffset = delta.nextOffset;
            stream.send('messages', { messages: delta.messages, nextOffset });
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offConversation();
            clearInterval(heartbeat);
        };
    });
});
app.get('/api/runs', (c) => {
    return c.json({ runs: runManager.listRuns() });
});
app.post('/api/runs', async (c) => {
    const body = await c.req.json().catch(() => null);
    const request = body;
    if (!request) {
        return c.json({ error: 'invalid request body' }, 400);
    }
    try {
        const run = await runManager.startRun(request);
        return c.json({ run }, 201);
    }
    catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : 'failed to start run',
        }, 400);
    }
});
app.post('/api/runs/:id/stop', (c) => {
    const run = runManager.stopRun(c.req.param('id'));
    if (!run) {
        return c.json({ error: 'run not found' }, 404);
    }
    return c.json({ run });
});
app.get('/api/runs/stream', (c) => {
    return createSseResponse(c, async (stream) => {
        stream.send('snapshot', { runs: runManager.listRuns() });
        const offRun = runManager.onRun((run) => {
            stream.send('run', { run });
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offRun();
            clearInterval(heartbeat);
        };
    });
});
app.get('/api/runs/:id/stream', (c) => {
    const runId = c.req.param('id');
    const run = runManager.getRun(runId);
    if (!run) {
        return c.json({ error: 'run not found' }, 404);
    }
    return createSseResponse(c, async (stream) => {
        stream.send('snapshot', {
            run,
            logs: runManager.getLogs(runId),
        });
        const offRun = runManager.onRun((update) => {
            if (update.id !== runId)
                return;
            stream.send('run', { run: update });
        });
        const offLog = runManager.onLog((entry) => {
            if (entry.runId !== runId)
                return;
            stream.send('log', { entry });
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offRun();
            offLog();
            clearInterval(heartbeat);
        };
    });
});
app.get('/api/terminals', (c) => {
    return c.json({ terminals: terminalManager.listSessions() });
});
app.post('/api/terminals', async (c) => {
    const body = await c.req.json().catch(() => null);
    const request = body;
    if (!request) {
        return c.json({ error: 'invalid request body' }, 400);
    }
    try {
        const terminal = await terminalManager.startSession(request);
        return c.json({ terminal }, 201);
    }
    catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : 'failed to start terminal',
        }, 400);
    }
});
app.post('/api/terminals/:id/input', async (c) => {
    const body = (await c.req.json().catch(() => null));
    if (!body || typeof body.input !== 'string') {
        return c.json({ error: 'input is required' }, 400);
    }
    const terminal = terminalManager.write(c.req.param('id'), body.input);
    if (!terminal) {
        return c.json({ error: 'terminal not found' }, 404);
    }
    return c.json({ terminal });
});
app.post('/api/terminals/:id/resize', async (c) => {
    const body = (await c.req.json().catch(() => null));
    if (!body || typeof body.cols !== 'number' || typeof body.rows !== 'number') {
        return c.json({ error: 'cols and rows are required' }, 400);
    }
    const terminal = terminalManager.resize(c.req.param('id'), body.cols, body.rows);
    if (!terminal) {
        return c.json({ error: 'terminal not found' }, 404);
    }
    return c.json({ terminal });
});
app.post('/api/terminals/:id/stop', (c) => {
    const terminal = terminalManager.stop(c.req.param('id'));
    if (!terminal) {
        return c.json({ error: 'terminal not found' }, 404);
    }
    return c.json({ terminal });
});
app.get('/api/terminals/stream', (c) => {
    return createSseResponse(c, async (stream) => {
        stream.send('snapshot', { terminals: terminalManager.listSessions() });
        const offSession = terminalManager.onSession((terminal) => {
            stream.send('terminal', { terminal });
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offSession();
            clearInterval(heartbeat);
        };
    });
});
app.get('/api/terminals/:id/stream', (c) => {
    const terminalId = c.req.param('id');
    const terminal = terminalManager.getSession(terminalId);
    if (!terminal) {
        return c.json({ error: 'terminal not found' }, 404);
    }
    return createSseResponse(c, async (stream) => {
        stream.send('snapshot', {
            terminal,
            outputs: terminalManager.getOutputs(terminalId),
        });
        const offSession = terminalManager.onSession((update) => {
            if (update.id !== terminalId)
                return;
            stream.send('terminal', { terminal: update });
        });
        const offOutput = terminalManager.onOutput((output) => {
            if (output.terminalId !== terminalId)
                return;
            stream.send('output', { output });
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offSession();
            offOutput();
            clearInterval(heartbeat);
        };
    });
});
app.get('/api/relays', (c) => {
    return c.json({ relays: relayManager.listRelays() });
});
app.post('/api/relays', async (c) => {
    const body = await c.req.json().catch(() => null);
    const request = body;
    if (!request) {
        return c.json({ error: 'invalid request body' }, 400);
    }
    try {
        const relay = await relayManager.startRelay(request);
        return c.json({ relay }, 201);
    }
    catch (error) {
        return c.json({
            error: error instanceof Error ? error.message : 'failed to start relay',
        }, 400);
    }
});
app.post('/api/relays/:id/stop', (c) => {
    const relay = relayManager.stopRelay(c.req.param('id'));
    if (!relay) {
        return c.json({ error: 'relay not found' }, 404);
    }
    return c.json({ relay });
});
app.get('/api/relays/stream', (c) => {
    return createSseResponse(c, async (stream) => {
        stream.send('snapshot', { relays: relayManager.listRelays() });
        const offRelay = relayManager.onRelay((relay) => {
            stream.send('relay', { relay });
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offRelay();
            clearInterval(heartbeat);
        };
    });
});
app.get('/api/relays/:id/stream', (c) => {
    const relayId = c.req.param('id');
    const relay = relayManager.getRelay(relayId);
    if (!relay) {
        return c.json({ error: 'relay not found' }, 404);
    }
    return createSseResponse(c, async (stream) => {
        stream.send('snapshot', {
            relay,
            turns: relayManager.getTurns(relayId),
        });
        const offRelay = relayManager.onRelay((update) => {
            if (update.id !== relayId)
                return;
            stream.send('relay', { relay: update });
        });
        const offTurn = relayManager.onTurn((turn) => {
            if (turn.relayId !== relayId)
                return;
            stream.send('turn', { turn });
        });
        const heartbeat = setInterval(() => stream.comment('heartbeat'), 15000);
        return () => {
            offRelay();
            offTurn();
            clearInterval(heartbeat);
        };
    });
});
app.get('/', (c) => c.text('cli-run-ui server'));
const port = Number(process.env.PORT ?? 4000);
serve({
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1',
});
console.log(`cli-run-ui server listening on http://127.0.0.1:${port}`);
async function listAllSessions() {
    const sessions = await Promise.all(providers.map((provider) => provider.listSessions()));
    return sessions.flat().sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}
function createSseResponse(c, handler) {
    const encoder = new TextEncoder();
    let cleanup;
    let closed = false;
    const stream = new ReadableStream({
        start(controller) {
            const sseStream = {
                send(event, data) {
                    if (closed)
                        return;
                    controller.enqueue(encoder.encode(`event: ${event}\n`));
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                },
                comment(text) {
                    if (closed)
                        return;
                    controller.enqueue(encoder.encode(`: ${text}\n\n`));
                },
                close() {
                    if (closed)
                        return;
                    closed = true;
                    controller.close();
                },
            };
            void handler(sseStream).then((result) => {
                cleanup = result;
            });
            c.req.raw.signal.addEventListener('abort', () => {
                if (closed)
                    return;
                closed = true;
                cleanup?.();
                controller.close();
            });
        },
        cancel() {
            if (closed)
                return;
            closed = true;
            cleanup?.();
        },
    });
    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    });
}
function createRuntimePersistenceTask(store, runs, terminals, relays) {
    let timer = null;
    let writing = false;
    let queued = false;
    const persist = async () => {
        if (writing) {
            queued = true;
            return;
        }
        writing = true;
        try {
            await store.save({
                runs: runs.listPersistedRuns(),
                terminals: terminals.listPersistedSessions(),
                relays: relays.listPersistedRelays(),
            });
        }
        catch (error) {
            console.warn('[cli-run-ui] Failed to persist runtime history:', error);
        }
        finally {
            writing = false;
            if (queued) {
                queued = false;
                void persist();
            }
        }
    };
    return {
        schedule() {
            if (timer)
                clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                void persist();
            }, 150);
        },
    };
}
//# sourceMappingURL=index.js.map