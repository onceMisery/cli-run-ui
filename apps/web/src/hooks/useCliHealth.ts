import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentCliHealthDTO } from '@cli-run-ui/core';
import { apiFetch, useApiConfig } from '@/lib/api';

export function useCliHealth(pollMs = 20000) {
  const { config } = useApiConfig();
  const [health, setHealth] = useState<AgentCliHealthDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const fetchHealth = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await apiFetch('/api/health/cli');
      const data = (await response.json().catch(() => null)) as
        | AgentCliHealthDTO
        | { error?: string }
        | null;
      if (!response.ok || !data || !('checks' in data)) {
        throw new Error(
          (data && 'error' in data && typeof data.error === 'string'
            ? data.error
            : 'Failed to load CLI health.')
        );
      }
      setHealth(data);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to load CLI health.');
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
    const timer = window.setInterval(() => {
      void fetchHealth();
    }, pollMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [fetchHealth, pollMs, config.baseUrl, config.token]);

  return {
    health,
    loading,
    error,
    refresh: fetchHealth,
  };
}
