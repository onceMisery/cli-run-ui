import path from 'node:path';
export function resolveProviderCliCommand(provider) {
    const envVar = provider === 'codex' ? 'CLI_RUN_UI_CODEX_COMMAND' : 'CLI_RUN_UI_CLAUDE_COMMAND';
    const fromEnv = process.env[envVar]?.trim();
    if (fromEnv) {
        return {
            command: fromEnv,
            envVar,
        };
    }
    const base = provider === 'codex' ? 'codex' : 'claude';
    return {
        command: base,
        envVar,
    };
}
export function buildProviderCommand(request) {
    if (!request.prompt.trim()) {
        throw new Error('Prompt is required.');
    }
    if (!path.isAbsolute(request.cwd)) {
        throw new Error('A valid absolute working directory is required.');
    }
    if (request.provider === 'codex') {
        const command = resolveProviderCliCommand(request.provider).command;
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
        const command = resolveProviderCliCommand(request.provider).command;
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
function extractSessionId(provider, sessionUid) {
    if (!sessionUid) {
        throw new Error('A session is required for resume mode.');
    }
    const [sessionProvider, sessionId] = sessionUid.split(':');
    if (sessionProvider !== provider || !sessionId) {
        throw new Error('Selected session does not match the chosen provider.');
    }
    return sessionId;
}
//# sourceMappingURL=providerCommands.js.map