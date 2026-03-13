import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SessionDTO } from '@cli-run-ui/core';

interface SessionListProps {
  sessions: SessionDTO[];
  activeUid: string | null;
  onSelect: (uid: string) => void;
}

export function SessionList({ sessions, activeUid, onSelect }: SessionListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 78,
    overscan: 6,
  });

  return (
    <div className="session-list" ref={parentRef}>
      {sessions.length === 0 && <div className="empty">No sessions yet</div>}
      <div className="session-spacer" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const session = sessions[virtualRow.index];
          const isActive = session.uid === activeUid;
          return (
            <button
              key={session.uid}
              className={`session-item ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(session.uid)}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
            >
              <div className="session-title">
                <span className={`provider-badge ${session.provider}`}>{session.provider}</span>
                <span>{session.title}</span>
              </div>
              <div className="session-meta">
                <span>{session.projectName}</span>
                <span className="muted">{formatRelative(session.updatedAtMs)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatRelative(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}
