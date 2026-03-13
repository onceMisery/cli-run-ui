import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ClaudeProvider } from './ClaudeProvider.js';

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/claude'
);

describe('ClaudeProvider', () => {
  it('lists sessions from history.jsonl', async () => {
    const provider = new ClaudeProvider({ rootDir: fixtureRoot });
    const sessions = await provider.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].uid).toBe('claude:sess-123');
    expect(sessions[0].projectPath).toBe('/tmp/projectA');
  });

  it('parses conversation with tool parts', async () => {
    const provider = new ClaudeProvider({ rootDir: fixtureRoot });
    const messages = await provider.getConversation('sess-123');
    expect(messages.length).toBe(2);
    const assistant = messages[1];
    const toolCall = assistant.parts.find((part) => part.kind === 'tool_call');
    const toolResult = assistant.parts.find((part) => part.kind === 'tool_result');
    expect(toolCall).toBeTruthy();
    expect(toolResult).toBeTruthy();
    if (toolCall && toolCall.kind === 'tool_call' && toolResult && toolResult.kind === 'tool_result') {
      expect(toolResult.toolCallId).toBe(toolCall.id);
    }
  });

  it('streams conversation with increasing offsets', async () => {
    const provider = new ClaudeProvider({ rootDir: fixtureRoot });
    const chunk = await provider.getConversationStream('sess-123', 0);
    expect(chunk.nextOffset).toBeGreaterThan(0);
    const chunk2 = await provider.getConversationStream('sess-123', chunk.nextOffset);
    expect(chunk2.nextOffset).toBe(chunk.nextOffset);
    expect(chunk2.messages.length).toBe(0);
  });
});