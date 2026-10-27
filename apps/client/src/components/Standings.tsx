import type { PlayerView } from '@jeopardy/shared';
import { formatMoney } from '../lib/format';

/** Players ranked by score, highest first. Ties keep seating order. */
export function ranked(players: PlayerView[]): PlayerView[] {
  return [...players].sort((a, b) => b.score - a.score);
}

export function Standings({
  players,
  highlightId,
  controlId,
}: {
  players: PlayerView[];
  highlightId?: string | null;
  controlId?: string | null;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {ranked(players).map((player, index) => (
        <li
          key={player.id}
          className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${
            player.id === highlightId ? 'bg-gold/20 ring-2 ring-gold' : 'bg-white/10'
          } ${player.connected ? '' : 'opacity-50'}`}
        >
          <span className="w-6 text-center font-display text-xl text-white/60">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">
            {player.name}
            {player.id === controlId ? <span title="In control"> 🎯</span> : null}
            {player.connected ? null : (
              <span className="ml-2 text-xs font-normal text-white/60">offline</span>
            )}
          </span>
          <span
            className={`font-display text-2xl tabular-nums ${player.score < 0 ? 'text-red-300' : 'text-gold'}`}
          >
            {formatMoney(player.score)}
          </span>
        </li>
      ))}
    </ol>
  );
}
