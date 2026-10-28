import type { PlayerView } from '@jeopardy/shared';
import { formatMoney } from '../lib/format';
import { ControlMarker } from './Studio';

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
    <ol className="flex flex-col gap-4">
      {ranked(players).map((player, index) => (
        <li
          key={player.id}
          className={`flex items-center gap-3 px-4 py-2.5 ${
            player.id === highlightId
              ? 'bg-royal shadow-[0_0_0_3px_var(--color-bulb),0_7px_0_3px_#000418]'
              : 'bg-royal-used pixel-frame'
          } ${player.connected ? '' : 'opacity-50'}`}
        >
          <span className="w-8 text-center font-pixel text-sm text-white/60">{index + 1}</span>
          <span className="flex min-w-0 flex-1 items-center gap-2 text-2xl uppercase leading-none">
            {player.id === controlId ? <ControlMarker /> : null}
            <span className="truncate">{player.name}</span>
            {player.connected ? null : <span className="text-base text-white/60">offline</span>}
          </span>
          <span
            className={`font-pixel text-sm pixel-drop-sm ${player.score < 0 ? 'text-neon-pink' : 'text-bulb'}`}
          >
            {formatMoney(player.score)}
          </span>
        </li>
      ))}
    </ol>
  );
}
