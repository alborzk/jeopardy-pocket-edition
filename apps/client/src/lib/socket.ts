import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  EventInput,
  EventName,
  EventResults,
  ServerToClientEvents,
} from '@jeopardy/shared';

/**
 * One socket for the whole app. It connects to the page's own origin: the Vite dev server
 * proxies /socket.io to the game server, so development is single-origin like production.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
  // Phones that wake up should be back in the room within a couple of seconds.
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
});

type RawEmit = {
  timeout(ms: number): {
    emit(
      event: string,
      payload: unknown,
      ack: (error: Error | null, response: unknown) => void,
    ): void;
  };
};

export const NOT_CONNECTED = 'Not connected';
export const TIMED_OUT = 'Timed out';

/**
 * Send an event and wait for its ack. Fails fast when offline instead of queueing the event:
 * a buzz that arrives seconds late is worse than one that is refused right away.
 */
export function request<K extends EventName>(
  event: K,
  payload: EventInput<K>,
): Promise<Ack<EventResults[K]>> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: NOT_CONNECTED });
      return;
    }
    (socket as unknown as RawEmit).timeout(8000).emit(event, payload, (error, response) => {
      resolve(error ? { ok: false, error: TIMED_OUT } : (response as Ack<EventResults[K]>));
    });
  });
}

/** Open the socket if needed and wait for it to connect. */
export function ensureConnected(timeoutMs = 6000): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (connected: boolean) => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      resolve(connected);
    };
    const onConnect = () => finish(true);
    socket.on('connect', onConnect);
    socket.connect();
  });
}
