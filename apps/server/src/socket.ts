import { eventSchemas } from '@jeopardy/shared';
import type {
  Ack,
  ClientToServerEvents,
  EventData,
  EventName,
  EventResults,
  ServerToClientEvents,
} from '@jeopardy/shared';
import type { Server } from 'socket.io';
import type { Client, HostAction, RoomManager } from './rooms/roomManager';

type Handler<K extends EventName> = (client: Client, data: EventData<K>) => Ack<EventResults[K]>;
type Handlers = { [K in EventName]: Handler<K> };

/** Each event maps to one room manager call. The manager checks the sender's role and the phase. */
export function createHandlers(manager: RoomManager): Handlers {
  const host = (client: Client, action: HostAction) => manager.hostAction(client.id, action);

  return {
    'room:create': (client) => manager.createRoom(client),
    'room:join': (client, { code, name }) => manager.join(client, code, name),
    'room:rejoin': (client, { code, token }) => manager.rejoin(client, code, token),
    'display:join': (client, { code }) => manager.displayJoin(client, code),

    'host:loadBoard': (client, { board }) => host(client, { type: 'loadBoard', board }),
    'host:start': (client) => host(client, { type: 'start' }),
    'host:selectClue': (client, { categoryIndex, clueIndex }) =>
      host(client, { type: 'selectClue', categoryIndex, clueIndex }),
    'host:openBuzzers': (client) => host(client, { type: 'openBuzzers' }),
    'host:judge': (client, { correct }) => host(client, { type: 'judge', correct }),
    'host:continue': (client) => host(client, { type: 'continue' }),
    'host:skipClue': (client) => host(client, { type: 'skipClue' }),
    'host:adjustScore': (client, { playerId, delta }) =>
      host(client, { type: 'adjustScore', playerId, delta }),
    'host:undo': (client) => manager.undo(client.id),
    'host:kick': (client, { playerId }) => manager.kick(client.id, playerId),
    'host:pause': (client) => host(client, { type: 'pause' }),
    'host:resume': (client) => host(client, { type: 'resume' }),
    'host:endGame': (client) => host(client, { type: 'endGame' }),
    'host:setSettings': (client, settings) => {
      const { buzzTimeoutMs, finalIncludeAll } = settings;
      return host(client, {
        type: 'setSettings',
        settings: {
          ...(buzzTimeoutMs !== undefined ? { buzzTimeoutMs } : {}),
          ...(finalIncludeAll !== undefined ? { finalIncludeAll } : {}),
        },
      });
    },
    'host:finalReveal': (client, { playerId }) => host(client, { type: 'finalReveal', playerId }),
    'host:finalJudge': (client, { playerId, correct }) =>
      host(client, { type: 'finalJudge', playerId, correct }),

    'player:buzz': (client) => manager.buzz(client.id),
    'player:wager': (client, { amount }) => manager.wager(client.id, amount),
    'player:finalAnswer': (client, { text }) => manager.finalAnswer(client.id, text),
  };
}

/** Socket.IO's own typing can't express a loop over every event, so register through this. */
type RawSocket = { on(event: string, listener: (...args: unknown[]) => void): unknown };

/** Generous enough for a frantic buzzer, small enough to stop a runaway client. */
const RATE_WINDOW_MS = 2000;
const RATE_MAX_EVENTS = 60;

export function attachSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  manager: RoomManager,
): void {
  const handlers = createHandlers(manager);

  io.on('connection', (socket) => {
    const client: Client = {
      id: socket.id,
      emit: (snapshot) => socket.emit('state', snapshot),
      disconnect: () => socket.disconnect(true),
    };
    const raw = socket as unknown as RawSocket;
    let windowStart = Date.now();
    let eventsInWindow = 0;

    for (const event of Object.keys(eventSchemas) as EventName[]) {
      raw.on(event, (payload: unknown, ack: unknown) => {
        // Every event carries an ack. Without one there is nowhere to send the answer.
        if (typeof ack !== 'function') return;
        const respond = ack as (response: Ack<object>) => void;

        const now = Date.now();
        if (now - windowStart > RATE_WINDOW_MS) {
          windowStart = now;
          eventsInWindow = 0;
        }
        if (++eventsInWindow > RATE_MAX_EVENTS) {
          respond({ ok: false, error: 'Slow down' });
          return;
        }

        const parsed = eventSchemas[event].safeParse(payload ?? {});
        if (!parsed.success) {
          respond({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' });
          return;
        }

        try {
          const handler = handlers[event] as (client: Client, data: unknown) => Ack<object>;
          respond(handler(client, parsed.data));
        } catch (error) {
          console.error(`Error handling ${event}`, error);
          respond({ ok: false, error: 'Something went wrong on the server' });
        }
      });
    }

    socket.on('disconnect', () => manager.disconnect(client.id));
  });
}
