import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from './utils';

type CopyFeedbackTone = 'success' | 'error';

interface CopyFeedbackEventDetail {
  id: number;
  message: string;
  tone: CopyFeedbackTone;
}

interface CopyFeedbackOptions {
  successMessage: string;
  errorMessage?: string;
}

const COPY_FEEDBACK_EVENT = 'cli-run-ui:copy-feedback';
const COPY_FEEDBACK_TIMEOUT_MS = 1800;

export async function copyTextWithFeedback(
  value: string,
  { successMessage, errorMessage = 'Copy failed.' }: CopyFeedbackOptions
): Promise<boolean> {
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    dispatchCopyFeedback({
      id: Date.now(),
      message: successMessage,
      tone: 'success',
    });
    return true;
  } catch {
    dispatchCopyFeedback({
      id: Date.now(),
      message: errorMessage,
      tone: 'error',
    });
    return false;
  }
}

export function CopyFeedbackHost() {
  const [feedback, setFeedback] = useState<CopyFeedbackEventDetail | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleFeedback = (event: Event) => {
      const detail = (event as CustomEvent<CopyFeedbackEventDetail>).detail;
      setFeedback(detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setFeedback((current) => (current?.id === detail.id ? null : current));
      }, COPY_FEEDBACK_TIMEOUT_MS);
    };

    window.addEventListener(COPY_FEEDBACK_EVENT, handleFeedback as EventListener);
    return () => {
      window.removeEventListener(COPY_FEEDBACK_EVENT, handleFeedback as EventListener);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!feedback) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50">
      <div
        className={cn(
          'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur',
          feedback.tone === 'success'
            ? 'border-emerald-400/25 bg-emerald-400/12 text-emerald-50'
            : 'border-rose-400/25 bg-rose-400/12 text-rose-50'
        )}
      >
        {feedback.tone === 'success' ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <CircleAlert className="h-4 w-4" />
        )}
        <span>{feedback.message}</span>
      </div>
    </div>
  );
}

function dispatchCopyFeedback(detail: CopyFeedbackEventDetail) {
  window.dispatchEvent(new CustomEvent<CopyFeedbackEventDetail>(COPY_FEEDBACK_EVENT, { detail }));
}
