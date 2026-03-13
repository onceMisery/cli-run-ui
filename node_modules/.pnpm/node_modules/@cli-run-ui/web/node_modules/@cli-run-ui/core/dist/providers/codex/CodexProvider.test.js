import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodexProvider } from './CodexProvider.js';
const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/codex');
describe('CodexProvider', () => {
    it('indexes sessions from rollout jsonl', async () => {
        const provider = new CodexProvider({ rootDir: fixtureRoot });
        const sessions = await provider.listSessions();
        expect(sessions.length).toBe(1);
        const session = sessions[0];
        expect(session).toBeDefined();
        expect(session?.uid).toBe('codex:codex-1');
        expect(session?.projectPath).toBe('/tmp/codexproj');
        expect(session?.usage?.total).toBe(123);
    });
    it('joins tool call and output', async () => {
        const provider = new CodexProvider({ rootDir: fixtureRoot });
        const messages = await provider.getConversation('codex-1');
        const toolMessage = messages.find((message) => message.parts.some((part) => part.kind === 'tool_call'));
        expect(toolMessage).toBeTruthy();
        if (toolMessage) {
            const hasResult = toolMessage.parts.some((part) => part.kind === 'tool_result');
            expect(hasResult).toBe(true);
        }
    });
    it('streams conversation with increasing offsets', async () => {
        const provider = new CodexProvider({ rootDir: fixtureRoot });
        const chunk = await provider.getConversationStream('codex-1', 0);
        expect(chunk.nextOffset).toBeGreaterThan(0);
        const chunk2 = await provider.getConversationStream('codex-1', chunk.nextOffset);
        expect(chunk2.nextOffset).toBe(chunk.nextOffset);
    });
});
//# sourceMappingURL=CodexProvider.test.js.map