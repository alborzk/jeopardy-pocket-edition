import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Role, Snapshot } from '@jeopardy/shared';
import { NOT_CONNECTED, TIMED_OUT, request, socket } from './socket';
import { clearSession, loadSession } from './session';

export const NO_SESSION = 'You have not joined this room on this device';

const RETRYABLE = new Set([NOT_CONNECTED, TIMED_OUT]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function subscribeConnection(onChange: () => void): () => void {
  socket.on('connect', onChange);
  socket.on('disconnect', onChange);
  return () => {
    socket.off('connect', onChange);
    socket.off('disconnect', onChange);
  };
}

/** Whether the socket is connected right now. */
export function useConnected(): boolean {
  return useSyncExternalStore(subscribeConnection, () => socket.connected);
}

export interface RoomView {
  snapshot: Snapshot | null;
  /** serverNow - localNow at the moment the snapshot arrived. */
  offset: number;
  connected: boolean;
  /** Set when the room can't be (re)joined: it no longer exists, or the token was refused. */
  error: string | null;
}

/**
 * Connects to a room and keeps the latest role-filtered snapshot. On every socket connect it
 * identifies itself again: the saved token for hosts and players (`room:rejoin`), or just the
 * room code for the display. Phones lock and drop sockets constantly, so this runs a lot.
 */
export function useRoom(code: string, role: Role): RoomView {
  const connected = useConnected();
  const [latest, setLatest] = useState<{ snapshot: Snapshot; offset: number } | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const hasSession = useMemo(
    () => role === 'display' || loadSession(code, role) !== null,
    [code, role],
  );

  useEffect(() => {
    let cancelled = false;

    const identify = async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        let result;
        if (role === 'display') {
          result = await request('display:join', { code });
        } else {
          const session = loadSession(code, role);
          if (!session) return;
          result = await request('room:rejoin', { code, token: session.token });
        }
        if (cancelled || result.ok) return;
        if (!RETRYABLE.has(result.error)) {
          if (role !== 'display') clearSession(code, role);
          setFatal(result.error);
          return;
        }
        await sleep(1000);
      }
    };

    const onState = (snapshot: Snapshot) => {
      setLatest({ snapshot, offset: snapshot.serverNow - Date.now() });
    };
    const onConnect = () => void identify();

    socket.on('state', onState);
    socket.on('connect', onConnect);
    if (socket.connected) void identify();
    else socket.connect();

    return () => {
      cancelled = true;
      socket.off('state', onState);
      socket.off('connect', onConnect);
    };
  }, [code, role]);

  const current = latest && latest.snapshot.code === code ? latest : null;
  return {
    snapshot: current?.snapshot ?? null,
    offset: current?.offset ?? 0,
    connected,
    error: fatal ?? (hasSession ? null : NO_SESSION),
  };
}
