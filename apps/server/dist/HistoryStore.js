import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
const EMPTY_HISTORY = {
    runs: [],
    terminals: [],
    relays: [],
    tasks: [],
};
export class HistoryStore {
    filePath;
    constructor(filePath = resolveHistoryFilePath()) {
        this.filePath = filePath;
    }
    async load() {
        try {
            const raw = await readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                runs: Array.isArray(parsed.runs) ? parsed.runs.filter(isRunRecord) : [],
                terminals: Array.isArray(parsed.terminals)
                    ? parsed.terminals.filter(isTerminalRecord)
                    : [],
                relays: Array.isArray(parsed.relays) ? parsed.relays.filter(isRelayRecord) : [],
                tasks: Array.isArray(parsed.tasks) ? parsed.tasks.filter(isTaskRecord) : [],
            };
        }
        catch (error) {
            const code = error && typeof error === 'object' && 'code' in error
                ? String(error.code)
                : null;
            if (code === 'ENOENT') {
                return EMPTY_HISTORY;
            }
            console.warn('[cli-run-ui] Failed to load runtime history:', error);
            return EMPTY_HISTORY;
        }
    }
    async save(snapshot) {
        const directory = path.dirname(this.filePath);
        const tempPath = `${this.filePath}.tmp`;
        const payload = {
            version: 3,
            savedAtMs: Date.now(),
            runs: trimRuns(snapshot.runs),
            terminals: trimTerminals(snapshot.terminals),
            relays: trimRelays(snapshot.relays),
            tasks: trimTasks(snapshot.tasks),
        };
        await mkdir(directory, { recursive: true });
        await writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
        await rename(tempPath, this.filePath);
    }
}
export function resolveHistoryFilePath() {
    const explicitFile = process.env.CLI_RUN_UI_HISTORY_FILE?.trim();
    if (explicitFile) {
        return path.resolve(explicitFile);
    }
    const explicitDir = process.env.CLI_RUN_UI_DATA_DIR?.trim();
    if (explicitDir) {
        return path.resolve(explicitDir, 'runtime-history.json');
    }
    return path.join(process.cwd(), '.cli-run-ui', 'runtime-history.json');
}
function trimRuns(runs) {
    return [...runs]
        .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs)
        .slice(0, 80);
}
function trimTerminals(terminals) {
    return [...terminals]
        .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs)
        .slice(0, 60);
}
function isRunRecord(value) {
    return !!value && typeof value === 'object' && 'summary' in value && 'logs' in value;
}
function isTerminalRecord(value) {
    return !!value && typeof value === 'object' && 'summary' in value && 'outputs' in value;
}
function trimRelays(relays) {
    return [...relays]
        .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs)
        .slice(0, 40);
}
function isRelayRecord(value) {
    return !!value && typeof value === 'object' && 'summary' in value && 'turns' in value;
}
function trimTasks(tasks) {
    return [...tasks]
        .sort((a, b) => b.summary.createdAtMs - a.summary.createdAtMs)
        .slice(0, 80);
}
function isTaskRecord(value) {
    return !!value && typeof value === 'object' && 'summary' in value && 'events' in value;
}
//# sourceMappingURL=HistoryStore.js.map