import { spawnSync } from 'node:child_process';
import { resolveProviderCliCommand } from './providerCommands.js';
export async function checkAgentCliHealth() {
    const checkedAtMs = Date.now();
    const checks = ['codex', 'claude'].map((provider) => probeCli(provider, checkedAtMs));
    return {
        checkedAtMs,
        checks,
    };
}
function probeCli(provider, checkedAtMs) {
    const resolved = resolveProviderCliCommand(provider);
    const command = resolved.command;
    const primary = runVersionProbe(command, '--version');
    if (primary.status === 'ready') {
        return {
            provider,
            command,
            envVar: resolved.envVar,
            status: 'ready',
            checkedAtMs,
            version: primary.output || undefined,
        };
    }
    const fallback = runVersionProbe(command, '-v');
    if (fallback.status === 'ready') {
        return {
            provider,
            command,
            envVar: resolved.envVar,
            status: 'ready',
            checkedAtMs,
            version: fallback.output || undefined,
        };
    }
    if (primary.status === 'missing' || fallback.status === 'missing') {
        return {
            provider,
            command,
            envVar: resolved.envVar,
            status: 'missing',
            checkedAtMs,
            message: `Command "${command}" was not found in PATH.`,
        };
    }
    const message = fallback.message || primary.message || 'Version probe failed.';
    return {
        provider,
        command,
        envVar: resolved.envVar,
        status: 'error',
        checkedAtMs,
        message,
    };
}
function runVersionProbe(command, flag) {
    try {
        const useShell = process.platform === 'win32';
        const result = spawnSync(command, [flag], {
            encoding: 'utf8',
            shell: useShell,
            windowsHide: true,
            timeout: 5000,
        });
        if (result.error) {
            if (result.error.code === 'ENOENT') {
                return { status: 'missing', message: result.error.message };
            }
            return { status: 'error', message: result.error.message };
        }
        const output = pickFirstLine(result.stdout, result.stderr);
        if (result.status === 0) {
            return { status: 'ready', output };
        }
        if (isCommandNotFoundMessage(output)) {
            return {
                status: 'missing',
                message: output,
            };
        }
        return {
            status: 'error',
            message: output ||
                `Exited with code ${result.status ?? 'unknown'} while probing ${flag}.`,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}
function pickFirstLine(stdout, stderr) {
    const text = `${stdout ?? ''}\n${stderr ?? ''}`.trim();
    if (!text)
        return '';
    return text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '';
}
function isCommandNotFoundMessage(message) {
    if (!message)
        return false;
    const normalized = message.toLowerCase();
    return (normalized.includes('is not recognized as an internal or external command') ||
        normalized.includes('不是内部或外部命令') ||
        normalized.includes('command not found'));
}
//# sourceMappingURL=AgentCliHealth.js.map