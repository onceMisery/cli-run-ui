import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from '@hono/cors';

import {
  ClaudeProvider,
  CodexProvider,
  type SessionProvider,
  WatcherHub,
} from '@cli-run-ui/core';

const app = new Hono();

const providers: SessionProvider[] = [new ClaudeProvider(), new CodexProvider()];
const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
const watcherHub = new WatcherHub(providers);
watcherHub.start();
void listAllSessions();

const devOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

const enableCors = process.env.NODE_ENV !== 'production';
if (enableCors) {
  app.use(
    '/api/*',
    cors({
      origin: (origin) => {
        if (!origin) return null;
        return devOrigins.has(origin) ? origin : null;
      },
      allowMethods: ['GET'],
      allowHeaders: ['Content-Type', 'X-Auth-Token'],
    })
  );
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
  const provider = providerMap.get(providerId as SessionProvider['id']);
  if (!provider || !sessionId) {
    return c.json({ error: 'invalid session uid' }, 400);
  }

  return createSseResponse(c, async (stream) => {
    let nextOffset = Number.isFinite(fromOffset) ? fromOffset : 0;
    const chunk = await provider.getConversationStream(sessionId, nextOffset);
    nextOffset = chunk.nextOffset;
    stream.send('messages', { messages: chunk.messages, nextOffset });

    const offConversation = watcherHub.onConversationAppended(async (sessionUid) => {
      if (sessionUid !== uid) return;
      const delta = await provider.getConversationStream(sessionId, nextOffset);
      if (delta.messages.length === 0) return;
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

function createSseResponse(c: Context, handler: (stream: SseStream) => Promise<(() => void) | void>) {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | void;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const sseStream: SseStream = {
        send(event, data) {
          if (closed) return;
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        },
        comment(text) {
          if (closed) return;
          controller.enqueue(encoder.encode(`: ${text}\n\n`));
        },
        close() {
          if (closed) return;
          closed = true;
          controller.close();
        },
      };

      void handler(sseStream).then((result) => {
        cleanup = result;
      });

      c.req.raw.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        cleanup?.();
        controller.close();
      });
    },
    cancel() {
      if (closed) return;
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

interface SseStream {
  send: (event: string, data: unknown) => void;
  comment: (text: string) => void;
  close: () => void;
}
