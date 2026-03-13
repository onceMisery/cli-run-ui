import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
const EMPTY_HISTORY = {
    runs: [],
    terminals: [],
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
            version: 1,
            savedAtMs: Date.now(),
            runs: trimRuns(snapshot.runs),
            terminals: trimTerminals(snapshot.terminals),
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
//# sourceMappingURL=HistoryStore.js.map