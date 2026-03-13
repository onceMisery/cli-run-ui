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

  const statusDotClass =
    sessionStatus === 'open'
      ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]'
      : sessionStatus === 'closed'
        ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.6)]'
        : 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]';

  return (
    <div className="min-h-screen md:grid md:grid-cols-[320px_1fr]">
      <aside className="flex flex-col gap-4 border-b border-border/60 bg-card/80 px-6 py-5 backdrop-blur md:border-b-0 md:border-r">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-semibold">cli-run-ui</div>
            <div className="text-xs text-muted-foreground">Local session browser</div>
          </div>
          <div className={`h-2.5 w-2.5 rounded-full ${statusDotClass}`}></div>
        </div>
        <SessionList
          sessions={sessions}
          activeUid={resolvedActiveUid}
          onSelect={setActiveSessionUid}
        />
      </aside>
      <main className="flex min-h-screen flex-col">
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
