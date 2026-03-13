import type { SessionDTO } from '@cli-run-ui/core';
import type { StreamStatus } from '../hooks/useSessionStream.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface HeaderBarProps {
  session: SessionDTO | null;
  sessionStatus: StreamStatus;
  conversationStatus: StreamStatus;
}

export function HeaderBar({ session, sessionStatus, conversationStatus }: HeaderBarProps) {
  const statusText = sessionStatus === 'open' ? 'Connected' : 'Disconnected';
  const conversationText = conversationStatus === 'open' ? 'Live' : 'Idle';

  return (
    <header className="flex items-center justify-between border-b border-border/60 bg-card/70 px-6 py-4 backdrop-blur">
      <div>
        {session ? (
          <>
            <div className="flex items-center gap-3 text-lg font-semibold">
              <Badge
                variant="outline"
                className={
                  session.provider === 'claude'
                    ? 'border-sky-400/40 text-sky-300'
                    : 'border-pink-400/40 text-pink-300'
                }
              >
                {session.provider}
              </Badge>
              <span>{session.projectName}</span>
              <span className="text-xs text-muted-foreground">{session.sessionId}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Started: {formatDate(session.startedAtMs)}</span>
              <span>Updated: {formatDate(session.updatedAtMs)}</span>
              {renderUsage(session)}
            </div>
          </>
        ) : (
          <div className="text-lg font-semibold">Select a session</div>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        {session && (
          <Button variant="outline" size="sm" onClick={() => copyResume(session)}>
            &gt;_ Resume
          </Button>
        )}
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              sessionStatus === 'open'
                ? 'bg-emerald-400'
                : sessionStatus === 'closed'
                  ? 'bg-rose-500'
                  : 'bg-amber-400'
            }`}
          ></span>
          <span>{statusText}</span>
          <span className="text-muted-foreground">{conversationText}</span>
        </div>
      </div>
    </header>
  );
}

function copyResume(session: SessionDTO) {
  const command = session.projectPath
    ? `cd ${session.projectPath} && ${session.resumeCommand}`
    : session.resumeCommand;
  void navigator.clipboard.writeText(command);
}

function renderUsage(session: SessionDTO) {
  const usage = session.usage;
  if (!usage) return null;
  const hasIO = usage.input !== undefined || usage.output !== undefined;
  if (hasIO) {
    return (
      <span>
        Tokens: {usage.input ?? 0} / {usage.output ?? 0}
      </span>
    );
  }
  if (usage.total !== undefined) {
    return <span>Tokens: {usage.total}</span>;
  }
  return null;
}

function formatDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleString();
}
