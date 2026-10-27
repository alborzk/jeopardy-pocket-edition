import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Snapshot } from '@jeopardy/shared';
import { useRemaining } from '../lib/clock';
import type { RoomView } from '../lib/useRoom';

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-buzz-out px-5 py-2 text-sm font-semibold text-white shadow-xl"
    >
      {message}
    </div>
  );
}

/** Sits in the page flow, so it pushes content down instead of covering it. */
export function ReconnectingBanner({
  connected,
  floating = false,
}: {
  connected: boolean;
  /** A small pill over the page instead, for the TV display. */
  floating?: boolean;
}) {
  if (connected) return null;
  return (
    <div
      role="status"
      className={
        floating
          ? 'fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-yellow-500 px-5 py-1.5 text-sm font-bold text-black shadow-lg'
          : 'sticky top-0 z-40 shrink-0 bg-yellow-500 px-3 py-1.5 text-center text-sm font-bold text-black'
      }
    >
      Reconnecting…
    </div>
  );
}

export function ScreenMessage({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-3xl uppercase tracking-wide text-gold">{title}</h1>
      {children ? <div className="max-w-md text-white/80">{children}</div> : null}
      {action}
    </div>
  );
}

export function HomeLink({ children = 'Back to start' }: { children?: ReactNode }) {
  return (
    <Link to="/" className="btn-secondary">
      {children}
    </Link>
  );
}

/** Shows a loading or error screen until the room has sent its first snapshot. */
export function RoomGate({
  room,
  children,
}: {
  room: RoomView;
  children: (snapshot: Snapshot) => ReactNode;
}) {
  if (room.error) {
    return (
      <ScreenMessage title="Can't open this room" action={<HomeLink />}>
        {room.error}
      </ScreenMessage>
    );
  }
  if (!room.snapshot) {
    return (
      <ScreenMessage title="Connecting…">
        {room.connected ? 'Joining the room.' : 'Reaching the server.'}
      </ScreenMessage>
    );
  }
  return <>{children(room.snapshot)}</>;
}

/** Whole seconds left, ticking. Empty when there is no timer. */
export function Countdown({
  snapshot,
  offset,
  className,
}: {
  snapshot: Snapshot;
  offset: number;
  className?: string;
}) {
  const remaining = useRemaining(snapshot.deadline, offset, snapshot.remainingMs);
  if (remaining === null) return null;
  return <span className={className}>{Math.ceil(remaining / 1000)}</span>;
}

/** A bar that drains as the server deadline approaches. */
export function CountdownBar({
  snapshot,
  offset,
  totalMs,
  className,
}: {
  snapshot: Snapshot;
  offset: number;
  totalMs: number;
  className?: string;
}) {
  const remaining = useRemaining(snapshot.deadline, offset, snapshot.remainingMs);
  if (remaining === null) return null;
  const fraction = Math.min(1, Math.max(0, remaining / totalMs));
  return (
    <div className={`h-3 w-full overflow-hidden rounded-full bg-white/15 ${className ?? ''}`}>
      <div
        className="h-full rounded-full bg-gold"
        style={{ width: `${fraction * 100}%`, transition: 'width 120ms linear' }}
      />
    </div>
  );
}

export function playerName(snapshot: Snapshot, id: string | null | undefined): string {
  return snapshot.players.find((p) => p.id === id)?.name ?? '—';
}
