import { useMemo, useState } from 'react';
import type { MessageDTO, SessionDTO } from '@cli-run-ui/core';

import { useSessionStream } from './hooks/useSessionStream.ts';
import { useConversationStream } from './hooks/useConversationStream.ts';
import { ConversationView } from './views/ConversationView.tsx';
import { SessionList } from './views/SessionList.tsx';
import { HeaderBar } from './views/HeaderBar.tsx';

export default function App() {
  const { sessions, status: sessionStatus } = useSessionStream();
  const [activeSessionUid, setActiveSessionUid] = useState<string | null>(null);

  const resolvedActiveUid = useMemo(() => {
    if (activeSessionUid && sessions.some((session) => session.uid === activeSessionUid)) {
      return activeSessionUid;
    }
    return sessions[0]?.uid ?? null;
  }, [activeSessionUid, sessions]);

  const activeSession = sessions.find((session) => session.uid === resolvedActiveUid) ?? null;

  const { messages, status: conversationStatus } = useConversationStream(resolvedActiveUid);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <div className="brand">cli-run-ui</div>
            <div className="muted">Local session browser</div>
          </div>
          <div className={`status-dot ${sessionStatus}`}></div>
        </div>
        <SessionList
          sessions={sessions}
          activeUid={resolvedActiveUid}
          onSelect={setActiveSessionUid}
        />
      </aside>
      <main className="main">
        <HeaderBar
          session={activeSession}
          sessionStatus={sessionStatus}
          conversationStatus={conversationStatus}
        />
        <ConversationView session={activeSession} messages={messages} />
      </main>
    </div>
  );
}

export type { SessionDTO, MessageDTO };