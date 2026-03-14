import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const MAX_TASK_EVENTS = 240;
const MAX_DIFF_EXCERPT_CHARS = 24000;
const MAX_TEST_OUTPUT_CHARS = 32000;
export class TaskManager {
    runManager;
    tasks = new Map();
    taskListeners = new Set();
    eventListeners = new Set();
    constructor(runManager, restoredTasks = []) {
        this.runManager = runManager;
        this.restore(restoredTasks);
        this.runManager.onRun((run) => {
            void this.handleRunUpdate(run);
        });
    }
    listTasks() {
        return Array.from(this.tasks.values())
            .map((entry) => entry.summary)
            .sort((left, right) => right.createdAtMs - left.createdAtMs);
    }
    getTask(taskId) {
        return this.tasks.get(taskId)?.summary ?? null;
    }
    getEvents(taskId) {
        return this.tasks.get(taskId)?.events ?? [];
    }
    listPersistedTasks() {
        return Array.from(this.tasks.values())
            .map((entry) => ({
            summary: entry.summary,
            events: [...entry.events],
        }))
            .sort((left, right) => right.summary.createdAtMs - left.summary.createdAtMs);
    }
    onTask(listener) {
        this.taskListeners.add(listener);
        return () => this.taskListeners.delete(listener);
    }
    onEvent(listener) {
        this.eventListeners.add(listener);
        return () => this.eventListeners.delete(listener);
    }
    async importGitHubIssueDraft(request) {
        const issue = await resolveGitHubIssue(request.issueUrl);
        const prompt = buildIssuePrompt(issue);
        return {
            issue,
            title: issue.title,
            prompt,
            branchName: normalizeTaskBranchName(undefined, issue.title),
        };
    }
    async startTask(request) {
        const git = await getGitRepoContext(request.cwd);
        if (git.dirty) {
            throw new Error('The git working tree has local changes. Commit or stash them before starting a task.');
        }
        const sourceIssue = request.issueUrl?.trim()
            ? await resolveGitHubIssue(request.issueUrl.trim())
            : undefined;
        const effectivePrompt = request.prompt.trim() || (sourceIssue ? buildIssuePrompt(sourceIssue) : '');
        if (!effectivePrompt) {
            throw new Error('Prompt is required.');
        }
        const title = request.title?.trim() || sourceIssue?.title || summarizeTaskTitle(effectivePrompt);
        const branchName = normalizeTaskBranchName(request.branchName, title);
        const baseBranch = request.baseBranch?.trim() || git.currentBranch;
        const taskId = randomUUID();
        const startedAtMs = Date.now();
        const summary = {
            id: taskId,
            title,
            provider: request.provider,
            mode: request.mode,
            cwd: request.cwd,
            prompt: effectivePrompt,
            repoRoot: git.repoRoot,
            repoName: git.repoName,
            baseBranch,
            branchName,
            createdAtMs: startedAtMs,
            startedAtMs,
            status: 'preparing',
            sessionUid: request.sessionUid,
            testCommand: request.testCommand?.trim() || undefined,
            workingTreeStatus: 'clean',
            changedFiles: [],
            testResult: {
                command: request.testCommand?.trim() || undefined,
                status: request.testCommand?.trim() ? 'idle' : 'skipped',
                output: '',
            },
            github: git.github,
            sourceIssue,
            pullRequestReviews: [],
            pullRequestComments: [],
            checks: [],
        };
        const internal = {
            summary,
            events: [],
        };
        this.tasks.set(taskId, internal);
        this.emitTask(summary);
        this.appendEvent(taskId, 'system', 'info', `Preparing task branch from ${baseBranch}.`);
        await checkoutTaskBranch(summary.repoRoot, baseBranch, branchName);
        this.appendEvent(taskId, 'git', 'success', `Checked out branch ${branchName}.`);
        try {
            const run = await this.runManager.startRun({
                provider: request.provider,
                mode: request.mode,
                cwd: request.cwd,
                prompt: effectivePrompt,
                sessionUid: request.sessionUid,
            });
            this.updateTask(taskId, {
                runId: run.id,
                status: run.status === 'failed' ? 'failed' : 'running',
            });
            this.appendEvent(taskId, 'system', 'success', `Assigned to ${request.provider}. Run ${run.id.slice(0, 8)} started.`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.updateTask(taskId, {
                status: 'failed',
                error: message,
                endedAtMs: Date.now(),
            });
            this.appendEvent(taskId, 'system', 'error', `Failed to start task run: ${message}`);
        }
        return this.tasks.get(taskId).summary;
    }
    stopTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return null;
        if (task.summary.runId) {
            this.runManager.stopRun(task.summary.runId);
        }
        this.updateTask(taskId, {
            status: 'stopped',
            endedAtMs: Date.now(),
        });
        this.appendEvent(taskId, 'system', 'info', 'Stop requested by cli-run-ui.');
        return task.summary;
    }
    async refreshTask(taskId, request = {}) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error('Task not found.');
        }
        if (!task.refreshPromise) {
            task.refreshPromise = this.runRefresh(taskId, request).finally(() => {
                const current = this.tasks.get(taskId);
                if (current)
                    current.refreshPromise = undefined;
            });
        }
        await task.refreshPromise;
        return this.tasks.get(taskId).summary;
    }
    async createPullRequest(taskId, request) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error('Task not found.');
        }
        await ensureBranchCheckedOut(task.summary.repoRoot, task.summary.branchName);
        const github = ensureGitHubReady(task.summary.github);
        const commitMessage = request.commitMessage?.trim() ||
            `${task.summary.title.slice(0, 72)}${task.summary.title.length > 72 ? '…' : ''}`;
        const aheadCount = await getAheadCount(task.summary.repoRoot, task.summary.baseBranch, task.summary.branchName);
        const workingTreeDirty = await hasWorkingTreeChanges(task.summary.repoRoot);
        if (workingTreeDirty) {
            await git(task.summary.repoRoot, ['add', '-A']);
            const hasStagedChanges = await hasStagedDiff(task.summary.repoRoot);
            if (hasStagedChanges) {
                await git(task.summary.repoRoot, ['commit', '-m', commitMessage]);
                this.appendEvent(taskId, 'git', 'success', `Committed changes with message "${commitMessage}".`);
            }
        }
        const aheadAfterCommit = await getAheadCount(task.summary.repoRoot, task.summary.baseBranch, task.summary.branchName);
        if (aheadCount === 0 && aheadAfterCommit === 0) {
            throw new Error('There are no committed changes to open as a pull request.');
        }
        await git(task.summary.repoRoot, ['push', '-u', 'origin', task.summary.branchName]);
        this.appendEvent(taskId, 'git', 'success', `Pushed branch ${task.summary.branchName} to origin.`);
        const response = await githubRequest(github, `/repos/${github.owner}/${github.name}/pulls`, {
            method: 'POST',
            body: {
                title: request.title?.trim() || task.summary.title,
                body: request.body?.trim() || buildPullRequestBody(task.summary),
                head: task.summary.branchName,
                base: task.summary.baseBranch,
                draft: Boolean(request.draft),
            },
        });
        const pullRequest = mapPullRequestResponse(response);
        this.updateTask(taskId, {
            pullRequest,
            github: {
                ...task.summary.github,
                compareUrl: buildGitHubCompareUrl(github, task.summary.baseBranch, task.summary.branchName),
                lastError: undefined,
            },
        });
        this.appendEvent(taskId, 'github', 'success', `Opened pull request #${pullRequest.number}.`);
        await this.refreshTask(taskId);
        return this.tasks.get(taskId).summary;
    }
    async reviewPullRequest(taskId, request) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error('Task not found.');
        }
        const pullRequest = task.summary.pullRequest;
        if (!pullRequest) {
            throw new Error('Open a pull request before sending a review.');
        }
        const github = ensureGitHubReady(task.summary.github);
        await githubRequest(github, `/repos/${github.owner}/${github.name}/pulls/${pullRequest.number}/reviews`, {
            method: 'POST',
            body: {
                event: request.event,
                body: request.body?.trim() || undefined,
            },
        });
        this.appendEvent(taskId, 'github', 'success', `${reviewEventLabel(request.event)} submitted on pull request #${pullRequest.number}.`);
        await this.refreshTask(taskId);
        return this.tasks.get(taskId).summary;
    }
    async mergePullRequest(taskId, request) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error('Task not found.');
        }
        const pullRequest = task.summary.pullRequest;
        if (!pullRequest) {
            throw new Error('Open a pull request before merging.');
        }
        const github = ensureGitHubReady(task.summary.github);
        await githubRequest(github, `/repos/${github.owner}/${github.name}/pulls/${pullRequest.number}/merge`, {
            method: 'PUT',
            body: {
                merge_method: request.method ?? 'squash',
                commit_title: request.commitTitle?.trim() || task.summary.title,
            },
        });
        this.updateTask(taskId, {
            status: 'merged',
            endedAtMs: Date.now(),
            archivedAtMs: Date.now(),
            pullRequest: {
                ...pullRequest,
                state: 'merged',
                mergedAtMs: Date.now(),
            },
        });
        this.appendEvent(taskId, 'github', 'success', `Merged pull request #${pullRequest.number} with ${(request.method ?? 'squash')} strategy.`);
        const cleanup = await cleanupMergedTaskBranch(task.summary.repoRoot, task.summary.baseBranch, task.summary.branchName);
        this.updateTask(taskId, { branchCleanup: cleanup });
        this.appendEvent(taskId, 'git', cleanup.localBranchDeleted ? 'success' : 'info', cleanup.message ?? 'Merge cleanup finished.');
        return this.tasks.get(taskId).summary;
    }
    async handleRunUpdate(run) {
        for (const task of this.tasks.values()) {
            if (task.summary.runId !== run.id)
                continue;
            if (run.status === 'starting' || run.status === 'running') {
                this.updateTask(task.summary.id, {
                    status: 'running',
                    error: undefined,
                });
                continue;
            }
            if (run.status === 'stopped') {
                this.updateTask(task.summary.id, {
                    status: 'stopped',
                    endedAtMs: run.endedAtMs ?? Date.now(),
                    error: run.error,
                });
                this.appendEvent(task.summary.id, 'system', 'info', 'Agent run stopped.');
                await this.refreshTask(task.summary.id, { rerunTests: false });
                continue;
            }
            if (run.status === 'failed') {
                this.updateTask(task.summary.id, {
                    status: 'failed',
                    endedAtMs: run.endedAtMs ?? Date.now(),
                    error: run.error,
                });
                this.appendEvent(task.summary.id, 'system', 'error', run.error ? `Agent run failed: ${run.error}` : 'Agent run failed.');
                await this.refreshTask(task.summary.id, { rerunTests: false });
                continue;
            }
            if (run.status === 'exited') {
                this.appendEvent(task.summary.id, 'system', 'success', 'Agent run completed.');
                await this.refreshTask(task.summary.id, { rerunTests: true });
            }
        }
    }
    async runRefresh(taskId, request) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        this.appendEvent(taskId, 'git', 'info', 'Refreshing git diff and repo status.');
        const repoSummary = await inspectTaskRepo(task.summary);
        let testResult = task.summary.testResult;
        if (request.rerunTests && task.summary.testCommand?.trim()) {
            testResult = await this.runTaskTests(task.summary);
        }
        const nextStatus = deriveTaskStatus(task.summary, testResult);
        this.updateTask(taskId, {
            ...repoSummary,
            testResult,
            status: nextStatus,
            endedAtMs: nextStatus === 'ready' || nextStatus === 'failed' || nextStatus === 'stopped'
                ? task.summary.endedAtMs ?? Date.now()
                : task.summary.endedAtMs,
            lastRefreshedAtMs: Date.now(),
            github: {
                ...repoSummary.github,
                compareUrl: buildGitHubCompareUrl(repoSummary.github, task.summary.baseBranch, task.summary.branchName),
            },
            pullRequest: repoSummary.pullRequest,
            pullRequestReviews: repoSummary.pullRequestReviews,
            pullRequestComments: repoSummary.pullRequestComments,
            checks: repoSummary.checks,
            branchProtection: repoSummary.branchProtection,
            mergeReadiness: repoSummary.mergeReadiness,
        });
        this.appendEvent(taskId, 'git', 'success', repoSummary.workingTreeStatus === 'clean'
            ? 'Repository is clean after refresh.'
            : `Detected ${repoSummary.changedFiles.length} changed file(s).`);
    }
    async runTaskTests(task) {
        const command = task.testCommand?.trim();
        if (!command) {
            return {
                command: undefined,
                status: 'skipped',
                output: '',
            };
        }
        this.appendEvent(task.id, 'test', 'info', `Running tests: ${command}`);
        const startedAtMs = Date.now();
        const result = await runShellCommand(command, task.repoRoot);
        const output = truncateText([result.stdout, result.stderr].filter(Boolean).join('\n'));
        const next = {
            command,
            status: result.exitCode === 0 ? 'passed' : 'failed',
            output,
            startedAtMs,
            endedAtMs: Date.now(),
            exitCode: result.exitCode,
            error: result.exitCode === 0 ? undefined : `Command exited with code ${result.exitCode}.`,
        };
        this.appendEvent(task.id, 'test', result.exitCode === 0 ? 'success' : 'error', result.exitCode === 0 ? 'Tests passed.' : `Tests failed with code ${result.exitCode}.`);
        return next;
    }
    updateTask(taskId, patch) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        task.summary = { ...task.summary, ...patch };
        this.emitTask(task.summary);
    }
    appendEvent(taskId, kind, tone, message) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        const event = {
            id: randomUUID(),
            taskId,
            kind,
            tone,
            message,
            createdAtMs: Date.now(),
        };
        task.events.push(event);
        if (task.events.length > MAX_TASK_EVENTS) {
            task.events.splice(0, task.events.length - MAX_TASK_EVENTS);
        }
        for (const listener of this.eventListeners) {
            listener(event);
        }
    }
    emitTask(task) {
        for (const listener of this.taskListeners) {
            listener(task);
        }
    }
    restore(restoredTasks) {
        const restoredAtMs = Date.now();
        for (const entry of restoredTasks) {
            const summary = normalizeRestoredTask(entry.summary, restoredAtMs);
            const events = Array.isArray(entry.events)
                ? entry.events.filter((event) => event.taskId === summary.id).slice(-MAX_TASK_EVENTS)
                : [];
            if (summary.status === 'stopped' && wasActiveTask(entry.summary.status)) {
                events.push({
                    id: randomUUID(),
                    taskId: summary.id,
                    kind: 'system',
                    tone: 'info',
                    message: '[cli-run-ui] Restored after server restart. The original task run is no longer attached.',
                    createdAtMs: restoredAtMs,
                });
            }
            this.tasks.set(summary.id, {
                summary,
                events,
            });
        }
    }
}
async function inspectTaskRepo(task) {
    const github = await refreshGitHubContext(task.repoRoot, task.github);
    const pullRequest = github.connected && task.pullRequest
        ? await refreshPullRequest(github, task.pullRequest.number).catch(() => task.pullRequest)
        : task.pullRequest;
    const branchProtection = github.connected && github.provider === 'github'
        ? await fetchBranchProtection(github, task.baseBranch).catch((error) => ({
            enabled: false,
            requiredCheckContexts: [],
            lastError: error instanceof Error ? error.message : 'Failed to load branch protection.',
        }))
        : undefined;
    const pullRequestReviews = github.connected && pullRequest
        ? await fetchPullRequestReviews(github, pullRequest.number).catch(() => task.pullRequestReviews)
        : task.pullRequestReviews;
    const pullRequestComments = github.connected && pullRequest
        ? await fetchPullRequestComments(github, pullRequest.number).catch(() => task.pullRequestComments)
        : task.pullRequestComments;
    const checks = github.connected && pullRequest?.headSha
        ? await fetchCheckRuns(github, pullRequest.headSha).catch(() => task.checks)
        : task.checks;
    const mergeReadiness = pullRequest
        ? buildMergeReadiness(pullRequest, pullRequestReviews, checks, branchProtection)
        : task.mergeReadiness;
    const workingTreeDirty = await hasWorkingTreeChanges(task.repoRoot);
    const changedFiles = await listChangedFiles(task.repoRoot, task.baseBranch);
    const diffStat = await buildDiffStat(task.repoRoot, task.baseBranch);
    const diffExcerpt = await buildDiffExcerpt(task.repoRoot, task.baseBranch);
    return {
        workingTreeStatus: workingTreeDirty || changedFiles.length > 0 ? 'dirty' : 'clean',
        diffStat,
        diffExcerpt,
        changedFiles,
        github,
        pullRequest,
        pullRequestReviews,
        pullRequestComments,
        checks,
        branchProtection,
        mergeReadiness,
    };
}
function deriveTaskStatus(task, testResult) {
    if (task.status === 'merged' || task.status === 'stopped')
        return task.status;
    if (task.error)
        return 'failed';
    if (testResult.status === 'failed')
        return 'failed';
    return 'ready';
}
function normalizeRestoredTask(task, restoredAtMs) {
    const status = wasActiveTask(task.status) ? 'stopped' : task.status;
    const testResult = task.testResult.status === 'running'
        ? {
            ...task.testResult,
            status: 'failed',
            endedAtMs: restoredAtMs,
            error: task.testResult.error ??
                '[cli-run-ui] Test process was interrupted by a server restart.',
        }
        : task.testResult;
    return {
        ...task,
        status,
        endedAtMs: status === 'stopped' ? task.endedAtMs ?? restoredAtMs : task.endedAtMs,
        testResult,
        pullRequestReviews: task.pullRequestReviews ?? [],
        pullRequestComments: task.pullRequestComments ?? [],
        checks: task.checks ?? [],
    };
}
function wasActiveTask(status) {
    return status === 'preparing' || status === 'running';
}
async function getGitRepoContext(cwd) {
    const repoRoot = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
    const currentBranch = (await git(repoRoot, ['branch', '--show-current'])).trim();
    const dirty = await hasWorkingTreeChanges(repoRoot);
    const remoteUrl = await gitOptional(repoRoot, ['remote', 'get-url', 'origin']);
    const parsedRemote = parseGitHubRemote(remoteUrl?.trim() || '');
    return {
        repoRoot,
        repoName: path.basename(repoRoot),
        currentBranch,
        dirty,
        github: {
            owner: parsedRemote?.owner ?? '',
            name: parsedRemote?.name ?? '',
            provider: parsedRemote ? 'github' : 'unknown',
            remoteUrl: remoteUrl?.trim() || undefined,
            connected: Boolean(parsedRemote),
            tokenConfigured: hasGitHubToken(),
            compareUrl: parsedRemote && currentBranch
                ? buildGitHubCompareUrl(parsedRemote, currentBranch, currentBranch)
                : undefined,
        },
    };
}
async function refreshGitHubContext(cwd, current) {
    const remoteUrl = await gitOptional(cwd, ['remote', 'get-url', 'origin']);
    const parsedRemote = parseGitHubRemote(remoteUrl?.trim() || '');
    return {
        owner: parsedRemote?.owner ?? current.owner,
        name: parsedRemote?.name ?? current.name,
        provider: parsedRemote ? 'github' : current.provider,
        remoteUrl: remoteUrl?.trim() || current.remoteUrl,
        connected: Boolean(parsedRemote || current.connected),
        tokenConfigured: hasGitHubToken(),
        compareUrl: current.compareUrl,
        defaultBranch: current.defaultBranch,
        lastError: current.lastError,
    };
}
async function checkoutTaskBranch(repoRoot, baseBranch, branchName) {
    await git(repoRoot, ['checkout', baseBranch]);
    await git(repoRoot, ['checkout', '-b', branchName]);
}
async function ensureBranchCheckedOut(repoRoot, branchName) {
    const currentBranch = (await git(repoRoot, ['branch', '--show-current'])).trim();
    if (currentBranch === branchName)
        return;
    const dirty = await hasWorkingTreeChanges(repoRoot);
    if (dirty) {
        throw new Error(`The working tree is dirty while ${currentBranch} is checked out. Switch back to ${branchName} after committing or stashing local changes.`);
    }
    await git(repoRoot, ['checkout', branchName]);
}
async function hasWorkingTreeChanges(cwd) {
    const status = await gitOptional(cwd, ['status', '--porcelain']);
    return Boolean(status?.trim());
}
async function hasStagedDiff(cwd) {
    const diff = await gitOptional(cwd, ['diff', '--cached', '--name-only']);
    return Boolean(diff?.trim());
}
async function getAheadCount(cwd, baseBranch, branchName) {
    const value = await gitOptional(cwd, ['rev-list', '--count', `${baseBranch}..${branchName}`]);
    return Number.parseInt(value?.trim() || '0', 10) || 0;
}
async function listChangedFiles(cwd, baseBranch) {
    const workingTree = (await gitOptional(cwd, ['status', '--porcelain=v1'])).trim();
    const committed = (await gitOptional(cwd, ['diff', '--name-status', '--find-renames', `${baseBranch}...HEAD`])).trim();
    const merged = new Map();
    for (const file of parseWorkingTreeFiles(workingTree)) {
        merged.set(file.path, file);
    }
    for (const file of parseNameStatusFiles(committed)) {
        merged.set(file.path, file);
    }
    return Array.from(merged.values()).slice(0, 200);
}
function parseWorkingTreeFiles(output) {
    if (!output)
        return [];
    return output
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
        if (line.startsWith('?? ')) {
            return { path: line.slice(3).trim(), status: 'untracked' };
        }
        const code = line.slice(0, 2).replace(/\s/g, '');
        const payload = line.slice(3).trim();
        if (payload.includes(' -> ') || code.startsWith('R')) {
            const [previousPath, nextPath] = payload.split(' -> ');
            return {
                path: (nextPath ?? previousPath ?? '').trim(),
                previousPath: previousPath?.trim(),
                status: 'renamed',
            };
        }
        return {
            path: payload,
            status: mapGitStatusCode(code),
        };
    });
}
function parseNameStatusFiles(output) {
    if (!output)
        return [];
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const [statusCode, first, second] = line.split('\t');
        if (!statusCode || !first) {
            return { path: line, status: 'unknown' };
        }
        if (statusCode.startsWith('R')) {
            return {
                path: second ?? first,
                previousPath: first,
                status: 'renamed',
            };
        }
        if (statusCode.startsWith('C')) {
            return {
                path: second ?? first,
                previousPath: first,
                status: 'copied',
            };
        }
        return {
            path: first,
            status: mapGitStatusCode(statusCode),
        };
    });
}
function mapGitStatusCode(code) {
    if (code.includes('A'))
        return 'added';
    if (code.includes('M'))
        return 'modified';
    if (code.includes('D'))
        return 'deleted';
    if (code.includes('R'))
        return 'renamed';
    if (code.includes('C'))
        return 'copied';
    if (code.includes('?'))
        return 'untracked';
    return 'unknown';
}
async function buildDiffStat(cwd, baseBranch) {
    const committed = (await gitOptional(cwd, ['diff', '--stat', '--find-renames', `${baseBranch}...HEAD`])).trim();
    const workingTree = (await gitOptional(cwd, ['diff', '--stat', '--find-renames'])).trim();
    return combineDiffSections(committed, workingTree);
}
async function buildDiffExcerpt(cwd, baseBranch) {
    const committed = (await gitOptional(cwd, [
        'diff',
        '--no-ext-diff',
        '--find-renames',
        '--unified=1',
        `${baseBranch}...HEAD`,
    ])).trim();
    const workingTree = (await gitOptional(cwd, ['diff', '--no-ext-diff', '--find-renames', '--unified=1'])).trim();
    const combined = combineDiffSections(committed, workingTree);
    return combined ? truncateText(combined, MAX_DIFF_EXCERPT_CHARS) : undefined;
}
function combineDiffSections(committed, workingTree) {
    const parts = [];
    if (committed) {
        parts.push(['Committed changes', committed].join('\n'));
    }
    if (workingTree) {
        parts.push(['Working tree changes', workingTree].join('\n'));
    }
    return parts.join('\n\n').trim() || undefined;
}
async function git(cwd, args) {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        windowsHide: true,
    });
    return stdout;
}
async function gitOptional(cwd, args) {
    try {
        return await git(cwd, args);
    }
    catch {
        return '';
    }
}
async function runShellCommand(command, cwd) {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            stdio: 'pipe',
            windowsHide: true,
            env: {
                ...process.env,
                FORCE_COLOR: '0',
                NO_COLOR: '1',
            },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => reject(error));
        child.on('close', (exitCode) => resolve({
            stdout,
            stderr,
            exitCode,
        }));
    });
}
function summarizeTaskTitle(prompt) {
    const normalized = prompt.replace(/\s+/g, ' ').trim();
    return normalized.slice(0, 80) || 'Agent task';
}
function normalizeTaskBranchName(branchName, title) {
    const raw = (branchName?.trim() || `task-${slugify(title)}-${Date.now().toString(36)}`)
        .replace(/[^a-zA-Z0-9/_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^\/+|\/+$/g, '');
    const normalized = raw.startsWith('codex/') ? raw : `codex/${raw}`;
    return normalized.toLowerCase();
}
function slugify(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'agent-task';
}
function parseGitHubRemote(remoteUrl) {
    if (!remoteUrl)
        return null;
    const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i);
    if (sshMatch) {
        const owner = sshMatch[1];
        const name = sshMatch[2];
        return {
            owner,
            name,
            compareBaseUrl: `https://github.com/${owner}/${name}`,
        };
    }
    try {
        const parsed = new URL(remoteUrl);
        if (parsed.hostname !== 'github.com')
            return null;
        const segments = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
        if (segments.length < 2)
            return null;
        const [owner, name] = segments;
        if (!owner || !name)
            return null;
        return {
            owner,
            name,
            compareBaseUrl: `https://github.com/${owner}/${name}`,
        };
    }
    catch {
        return null;
    }
}
async function resolveGitHubIssue(issueUrl) {
    const locator = parseGitHubIssueUrl(issueUrl);
    if (!locator) {
        throw new Error('Provide a valid GitHub issue URL like https://github.com/owner/repo/issues/123.');
    }
    const token = readGitHubToken();
    const response = await fetch(`${resolveGitHubApiBaseUrl()}/repos/${locator.owner}/${locator.name}/issues/${locator.number}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'User-Agent': 'cli-run-ui',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok) {
        const data = (await response.json().catch(() => null));
        throw new Error(data?.message ?? `Failed to load GitHub issue (${response.status}).`);
    }
    const payload = (await response.json());
    if (payload.pull_request) {
        throw new Error('This URL points to a pull request. Use a GitHub issue URL instead.');
    }
    return {
        number: payload.number,
        url: payload.html_url,
        title: payload.title,
        state: payload.state,
        body: payload.body ?? undefined,
        createdAtMs: Date.parse(payload.created_at),
        updatedAtMs: payload.updated_at ? Date.parse(payload.updated_at) : undefined,
    };
}
function parseGitHubIssueUrl(value) {
    try {
        const parsed = new URL(value);
        if (parsed.hostname !== 'github.com')
            return null;
        const parts = parsed.pathname.replace(/^\/+/, '').split('/');
        if (parts.length < 4 || parts[2] !== 'issues')
            return null;
        const issueNumber = Number.parseInt(parts[3] ?? '', 10);
        if (!parts[0] || !parts[1] || !Number.isFinite(issueNumber))
            return null;
        return {
            owner: parts[0],
            name: parts[1],
            number: issueNumber,
        };
    }
    catch {
        return null;
    }
}
async function refreshPullRequest(github, pullRequestNumber) {
    if (!github.connected || github.provider !== 'github' || !github.owner || !github.name) {
        return undefined;
    }
    const token = readGitHubToken();
    const response = await fetch(`${resolveGitHubApiBaseUrl()}/repos/${github.owner}/${github.name}/pulls/${pullRequestNumber}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'User-Agent': 'cli-run-ui',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok) {
        return undefined;
    }
    const payload = (await response.json());
    return mapPullRequestResponse(payload);
}
function buildIssuePrompt(issue) {
    const lines = [
        `Work on GitHub issue #${issue.number}: ${issue.title}`,
        '',
        'Goal:',
        issue.title,
    ];
    if (issue.body?.trim()) {
        lines.push('', 'Issue details:', issue.body.trim());
    }
    lines.push('', 'Please implement the change in the current repository, explain the approach briefly, and leave the branch ready for review.');
    return lines.join('\n');
}
async function fetchPullRequestReviews(github, pullRequestNumber) {
    if (!github.connected || github.provider !== 'github' || !github.owner || !github.name) {
        return [];
    }
    const token = readGitHubToken();
    const response = await fetch(`${resolveGitHubApiBaseUrl()}/repos/${github.owner}/${github.name}/pulls/${pullRequestNumber}/reviews`, {
        headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'User-Agent': 'cli-run-ui',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok)
        return [];
    const payload = (await response.json());
    return payload.map((entry) => ({
        id: entry.id,
        author: entry.user?.login?.trim() || 'unknown',
        state: entry.state,
        body: entry.body ?? undefined,
        submittedAtMs: entry.submitted_at ? Date.parse(entry.submitted_at) : undefined,
        url: entry.html_url,
    }));
}
async function fetchPullRequestComments(github, pullRequestNumber) {
    if (!github.connected || github.provider !== 'github' || !github.owner || !github.name) {
        return [];
    }
    const token = readGitHubToken();
    const response = await fetch(`${resolveGitHubApiBaseUrl()}/repos/${github.owner}/${github.name}/issues/${pullRequestNumber}/comments`, {
        headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'User-Agent': 'cli-run-ui',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok)
        return [];
    const payload = (await response.json());
    return payload.map((entry) => ({
        id: entry.id,
        author: entry.user?.login?.trim() || 'unknown',
        body: entry.body ?? '',
        createdAtMs: Date.parse(entry.created_at),
        updatedAtMs: entry.updated_at ? Date.parse(entry.updated_at) : undefined,
        url: entry.html_url,
    }));
}
async function fetchCheckRuns(github, ref) {
    if (!github.connected || github.provider !== 'github' || !github.owner || !github.name) {
        return [];
    }
    const token = readGitHubToken();
    const response = await fetch(`${resolveGitHubApiBaseUrl()}/repos/${github.owner}/${github.name}/commits/${ref}/check-runs`, {
        headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'User-Agent': 'cli-run-ui',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (!response.ok)
        return [];
    const payload = (await response.json());
    return (payload.check_runs ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        status: entry.status,
        conclusion: entry.conclusion ?? undefined,
        url: entry.html_url,
        details: [entry.output?.title, entry.output?.summary].filter(Boolean).join(' - ') || undefined,
    }));
}
async function fetchBranchProtection(github, branch) {
    if (!github.connected || github.provider !== 'github' || !github.owner || !github.name) {
        return {
            enabled: false,
            requiredCheckContexts: [],
        };
    }
    const token = readGitHubToken();
    if (!token) {
        return {
            enabled: false,
            requiredCheckContexts: [],
            lastError: 'GitHub token missing for branch protection lookup.',
        };
    }
    const response = await fetch(`${resolveGitHubApiBaseUrl()}/repos/${github.owner}/${github.name}/branches/${encodeURIComponent(branch)}/protection`, {
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'cli-run-ui',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });
    if (response.status === 404) {
        return {
            enabled: false,
            requiredCheckContexts: [],
        };
    }
    if (!response.ok) {
        return {
            enabled: false,
            requiredCheckContexts: [],
            lastError: `Branch protection request returned ${response.status}.`,
        };
    }
    const payload = (await response.json());
    return {
        enabled: true,
        requiredApprovingReviewCount: payload.required_pull_request_reviews?.required_approving_review_count ?? undefined,
        dismissesStaleReviews: payload.required_pull_request_reviews?.dismiss_stale_reviews ?? undefined,
        requiresConversationResolution: payload.required_conversation_resolution?.enabled ?? undefined,
        strictStatusChecks: payload.required_status_checks?.strict ?? undefined,
        requiredCheckContexts: payload.required_status_checks?.contexts ?? [],
    };
}
function buildMergeReadiness(pullRequest, reviews, checks, branchProtection) {
    const reasons = [];
    if (pullRequest.state !== 'open' && pullRequest.state !== 'draft') {
        reasons.push(`Pull request is ${pullRequest.state}.`);
    }
    if (pullRequest.draft || pullRequest.state === 'draft') {
        reasons.push('Pull request is still marked as draft.');
    }
    if (pullRequest.mergeable === false) {
        reasons.push('GitHub reports that the pull request is not mergeable.');
    }
    if (pullRequest.mergeStateStatus && ['dirty', 'blocked', 'behind', 'unstable'].includes(pullRequest.mergeStateStatus)) {
        reasons.push(`Merge state is ${pullRequest.mergeStateStatus}.`);
    }
    const approvals = reviews.filter((review) => review.state.toUpperCase() === 'APPROVED').length;
    const requestedChanges = reviews.filter((review) => review.state.toUpperCase() === 'CHANGES_REQUESTED').length;
    if (requestedChanges > 0) {
        reasons.push('There are outstanding change requests on the pull request.');
    }
    if (branchProtection?.requiredApprovingReviewCount) {
        if (approvals < branchProtection.requiredApprovingReviewCount) {
            reasons.push(`Requires ${branchProtection.requiredApprovingReviewCount} approval(s); only ${approvals} recorded.`);
        }
    }
    const failedChecks = checks.filter((check) => check.status === 'completed' && check.conclusion && !['success', 'neutral', 'skipped'].includes(check.conclusion));
    const pendingChecks = checks.filter((check) => check.status !== 'completed' || check.conclusion === 'pending');
    if (failedChecks.length > 0) {
        reasons.push(`${failedChecks.length} GitHub check(s) are failing.`);
    }
    if (pendingChecks.length > 0) {
        reasons.push(`${pendingChecks.length} GitHub check(s) are still pending.`);
    }
    if (branchProtection?.requiredCheckContexts.length) {
        const checkNames = new Set(checks.map((check) => check.name));
        const missingRequiredChecks = branchProtection.requiredCheckContexts.filter((context) => !checkNames.has(context));
        if (missingRequiredChecks.length > 0) {
            reasons.push(`Missing required status checks: ${missingRequiredChecks.join(', ')}.`);
        }
    }
    return {
        ready: reasons.length === 0,
        reasons,
        mergeable: pullRequest.mergeable,
        mergeStateStatus: pullRequest.mergeStateStatus,
    };
}
async function cleanupMergedTaskBranch(repoRoot, baseBranch, branchName) {
    let baseBranchCheckedOut = false;
    let localBranchDeleted = false;
    let remoteBranchDeleted = false;
    const notes = [];
    try {
        await git(repoRoot, ['checkout', baseBranch]);
        baseBranchCheckedOut = true;
        notes.push(`Checked out ${baseBranch}.`);
    }
    catch (error) {
        notes.push(error instanceof Error
            ? `Failed to checkout ${baseBranch}: ${error.message}`
            : `Failed to checkout ${baseBranch}.`);
    }
    try {
        await git(repoRoot, ['branch', '-d', branchName]);
        localBranchDeleted = true;
        notes.push(`Deleted local branch ${branchName}.`);
    }
    catch (error) {
        notes.push(error instanceof Error
            ? `Local branch cleanup skipped: ${error.message}`
            : 'Local branch cleanup skipped.');
    }
    if (process.env.CLI_RUN_UI_DELETE_REMOTE_BRANCH_ON_MERGE === '1') {
        try {
            await git(repoRoot, ['push', 'origin', '--delete', branchName]);
            remoteBranchDeleted = true;
            notes.push(`Deleted remote branch ${branchName}.`);
        }
        catch (error) {
            notes.push(error instanceof Error
                ? `Remote branch cleanup skipped: ${error.message}`
                : 'Remote branch cleanup skipped.');
        }
    }
    else {
        notes.push('Remote branch deletion disabled.');
    }
    return {
        baseBranchCheckedOut,
        localBranchDeleted,
        remoteBranchDeleted,
        message: notes.join(' '),
    };
}
function buildGitHubCompareUrl(github, baseBranch, branchName) {
    if (github.connected === false || github.provider === 'unknown' || !github.owner || !github.name) {
        return undefined;
    }
    return `https://github.com/${github.owner}/${github.name}/compare/${baseBranch}...${branchName}?expand=1`;
}
function ensureGitHubReady(github) {
    if (!github.connected || github.provider !== 'github' || !github.owner || !github.name) {
        throw new Error('This repository is not connected to GitHub via the origin remote.');
    }
    const token = readGitHubToken();
    if (!token) {
        throw new Error('Set CLI_RUN_UI_GITHUB_TOKEN (or GITHUB_TOKEN) to enable one-click pull request, review, and merge actions.');
    }
    return {
        owner: github.owner,
        name: github.name,
        token,
    };
}
function hasGitHubToken() {
    return Boolean(readGitHubToken());
}
function readGitHubToken() {
    return process.env.CLI_RUN_UI_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || '';
}
async function githubRequest(github, pathname, options = {}) {
    const response = await fetch(`${resolveGitHubApiBaseUrl()}${pathname}`, {
        method: options.method ?? 'GET',
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${github.token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'cli-run-ui',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) {
        const data = (await response.json().catch(() => null));
        throw new Error(data?.message ?? `GitHub API request failed with status ${response.status}.`);
    }
    if (response.status === 204) {
        return undefined;
    }
    return (await response.json());
}
function resolveGitHubApiBaseUrl() {
    return process.env.CLI_RUN_UI_GITHUB_API_BASE_URL?.trim() || 'https://api.github.com';
}
function buildPullRequestBody(task) {
    const lines = [
        '## Summary',
        '',
        `- Task: ${task.title}`,
        `- Provider: ${task.provider}`,
        `- Branch: ${task.branchName}`,
    ];
    if (task.testResult.command) {
        lines.push(`- Tests: ${task.testResult.status === 'passed' ? 'passed' : task.testResult.status}`);
    }
    if (task.diffStat) {
        lines.push('', '## Diff Stat', '', '```', task.diffStat, '```');
    }
    if (task.sourceIssue) {
        lines.push('', '## Linked Issue', '', `Closes #${task.sourceIssue.number}`, '', `Source: ${task.sourceIssue.url}`);
    }
    return lines.join('\n');
}
function mapPullRequestResponse(response) {
    return {
        number: response.number,
        url: response.html_url,
        title: response.title,
        state: response.merged_at
            ? 'merged'
            : response.draft
                ? 'draft'
                : response.state,
        headBranch: response.head.ref,
        headSha: response.head.sha,
        baseBranch: response.base.ref,
        draft: Boolean(response.draft),
        mergeable: response.mergeable,
        mergeStateStatus: response.mergeable_state,
        createdAtMs: Date.parse(response.created_at),
        mergedAtMs: response.merged_at ? Date.parse(response.merged_at) : undefined,
    };
}
function reviewEventLabel(event) {
    if (event === 'APPROVE')
        return 'Approval';
    if (event === 'REQUEST_CHANGES')
        return 'Request changes';
    return 'Review comment';
}
function truncateText(value, limit = MAX_TEST_OUTPUT_CHARS) {
    if (value.length <= limit)
        return value;
    return `${value.slice(0, limit)}\n\n[truncated]`;
}
//# sourceMappingURL=TaskManager.js.map