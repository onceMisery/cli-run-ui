import type { SessionDTO } from '@cli-run-ui/core';
import type { StreamStatus } from '../hooks/useSessionStream.ts';

interface HeaderBarProps {
  session: SessionDTO | null;
  sessionStatus: StreamStatus;
  conversationStatus: StreamStatus;
}

export function HeaderBar({ session, sessionStatus, conversationStatus }: HeaderBarProps) {
  const statusText = sessionStatus === 'open' ? 'Connected' : 'Disconnected';
  const conversationText = conversationStatus === 'open' ? 'Live' : 'Idle';

  return (
    <header className="header">
      <div>
        {session ? (
          <>
            <div className="header-title">
              <span className={`provider-pill ${session.provider}`}>{session.provider}</span>
              <span>{session.projectName}</span>
              <span className="muted">{session.sessionId}</span>
            </div>
            <div className="header-sub">
              <span>Started: {formatDate(session.startedAtMs)}</span>
              <span>Updated: {formatDate(session.updatedAtMs)}</span>
              {session.usage?.input || session.usage?.output ? (
                <span>
                  Tokens: {session.usage?.input ?? 0} / {session.usage?.output ?? 0}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="header-title">Select a session</div>
        )}
      </div>
      <div className="header-actions">
        {session && (
          <button className="btn" onClick={() => copyResume(session)}>
            &gt;_ Resume
          </button>
        )}
        <div className="status">
          <span className={`status-dot ${sessionStatus}`}></span>
          <span>{statusText}</span>
          <span className="muted">{conversationText}</span>
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

function formatDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleString();
}