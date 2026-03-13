import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { SessionDTO } from '@cli-run-ui/core';
import { Badge } from '@/components/ui/badge';

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
    <div ref={parentRef} className="relative flex-1 overflow-auto pr-2">
      {sessions.length === 0 && <div className="text-sm text-muted-foreground">No sessions yet</div>}
      <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const session = sessions[virtualRow.index];
          const isActive = session.uid === activeUid;
          return (
            <button
              key={session.uid}
              className={`
                absolute left-0 w-full rounded-xl border px-3 py-2 text-left shadow-sm transition
                ${isActive ? 'border-primary/60 bg-primary/5' : 'border-border/60 bg-card/70 hover:bg-card'}
              `}
              onClick={() => onSelect(session.uid)}
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
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
                <span className="truncate">{session.title}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">{session.projectName}</span>
                <span>{formatRelative(session.updatedAtMs)}</span>
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
