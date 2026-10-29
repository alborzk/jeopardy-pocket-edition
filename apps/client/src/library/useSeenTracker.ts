import { useEffect, useRef } from 'react';
import type { Snapshot } from '@jeopardy/shared';
import { markSeen } from './seen';

/**
 * Host side of "unseen first": once a clue has been played, remember it so the next board built
 * on this device leads with clues nobody has seen. A clue counts as played when its answer is
 * revealed (including a skipped one, since the players saw it), and the Final clue once it's up.
 *
 * It uses what the host snapshot already carries (category and clue text), so no server change.
 */
export function useSeenTracker(snapshot: Snapshot): void {
  const recorded = useRef(new Set<string>());
  const { code, phase, current, final, board } = snapshot;
  const roundIndex = board?.roundIndex;
  const currentClue = current?.clue;
  const currentCategory = current?.category;
  const categoryIndex = current?.categoryIndex;
  const clueIndex = current?.clueIndex;
  const finalClue = final?.clue;
  const finalCategory = final?.category;

  useEffect(() => {
    if (phase === 'reveal' && currentClue && currentCategory) {
      const id = `${code}:${roundIndex}:${categoryIndex}:${clueIndex}`;
      if (!recorded.current.has(id)) {
        recorded.current.add(id);
        markSeen(currentCategory, currentClue);
      }
    }
    if ((phase === 'finalAnswer' || phase === 'finalReveal') && finalClue && finalCategory) {
      const id = `${code}:final`;
      if (!recorded.current.has(id)) {
        recorded.current.add(id);
        markSeen(finalCategory, finalClue);
      }
    }
  }, [
    code,
    phase,
    roundIndex,
    categoryIndex,
    clueIndex,
    currentClue,
    currentCategory,
    finalClue,
    finalCategory,
  ]);
}
