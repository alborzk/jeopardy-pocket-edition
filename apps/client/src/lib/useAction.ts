import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ack, EventInput, EventName, EventResults } from '@jeopardy/shared';
import { request } from './socket';

/**
 * Send events and surface a refusal as a short-lived message. The server is the source of truth,
 * so the UI never predicts a result: it sends the event and renders the snapshot that comes back.
 */
export function useAction() {
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(
    async <K extends EventName>(
      event: K,
      payload: EventInput<K>,
    ): Promise<Ack<EventResults[K]>> => {
      const result = await request(event, payload);
      if (!result.ok) {
        setError(result.error);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setError(null), 3500);
      }
      return result;
    },
    [],
  );

  return { run, error };
}
