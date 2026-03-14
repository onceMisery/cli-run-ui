import path from 'node:path';

import type { ProviderId, RunMode } from '@cli-run-ui/core';

interface ProviderCommandRequest {
  provider: ProviderId;
  mode: RunMode;
  cwd: string;
  prompt: string;
  sessionUid?: string;
}

export function buildProviderCommand(request: ProviderCommandRequest): {
  command: string;
  args: string[];
} {
  if (!request.prompt.trim()) {
    throw new Error('Prompt is required.');
  }

  if (!path.isAbsolute(request.cwd)) {
    throw new Error('A valid absolute working directory is required.');
  }

  if (request.provider === 'codex') {
    const command = process.env.CLI_RUN_UI_CODEX_COMMAND ?? 'codex';
    if (request.mode === 'resume') {
      const sessionId = extractSessionId(request.provider, request.sessionUid);
      return {
        command,
        args: ['exec', '--skip-git-repo-check', 'resume', sessionId, request.prompt],
      };
    }
    return {
      command,
      args: ['exec', '--skip-git-repo-check', request.prompt],
    };
  }

  if (request.provider === 'claude') {
    const command = process.env.CLI_RUN_UI_CLAUDE_COMMAND ?? 'claude';
    if (request.mode === 'resume') {
      const sessionId = extractSessionId(request.provider, request.sessionUid);
      return {
        command,
        args: ['--resume', sessionId, '--print', request.prompt],
      };
    }
    return {
      command,
      args: ['--print', request.prompt],
    };
  }

  throw new Error(`Unsupported provider: ${request.provider}`);
}

function extractSessionId(provider: ProviderId, sessionUid?: string): string {
  if (!sessionUid) {
    throw new Error('A session is required for resume mode.');
  }
  const [sessionProvider, sessionId] = sessionUid.split(':');
  if (sessionProvider !== provider || !sessionId) {
    throw new Error('Selected session does not match the chosen provider.');
  }
  return sessionId;
}
