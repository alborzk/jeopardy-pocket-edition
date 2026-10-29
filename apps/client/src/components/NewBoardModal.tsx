import { useState } from 'react';
import { createEmptyBoard } from '@jeopardy/shared';
import type { Board } from '@jeopardy/shared';
import { PER_ROUND, dealBoard, surpriseCategories } from '../library/deal';
import { RECIPES } from '../library/recipes';
import { loadAvoidSeen, loadSeen } from '../library/seen';
import { Modal } from './Modal';

export interface NewBoardModalProps {
  open: boolean;
  onClose: () => void;
  /** Gets the new board. The caller adds it and closes the modal. */
  onCreate: (board: Board) => void;
}

/** Start a board empty, or have the library deal one from a ready-made mix or at random. */
export function NewBoardModal({ open, onClose, onCreate }: NewBoardModalProps) {
  return (
    <Modal
      wide
      open={open}
      title="New board"
      onClose={onClose}
      actions={
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      }
    >
      {open ? <NewBoardBody onCreate={onCreate} /> : null}
    </Modal>
  );
}

type Format = 'full' | 'quick';

function Tile({
  title,
  blurb,
  onClick,
  disabled,
}: {
  title: string;
  blurb: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="tap-target flex flex-col gap-1 bg-royal-used px-3 py-2 text-left transition pixel-frame hover:bg-royal disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-royal-used"
    >
      <span className="truncate text-xl uppercase leading-tight">{title}</span>
      <span className="text-base opacity-75">{blurb}</span>
    </button>
  );
}

function NewBoardBody({ onCreate }: Pick<NewBoardModalProps, 'onCreate'>) {
  const [format, setFormat] = useState<Format>('full');
  // The tile being dealt. The others wait, so a double tap can't make two boards.
  const [dealing, setDealing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deal = async (
    id: string,
    title: string,
    round1: readonly string[],
    round2: readonly string[],
  ) => {
    setDealing(id);
    setError(null);
    try {
      onCreate(
        await dealBoard({
          title,
          round1,
          round2: format === 'full' ? round2 : [],
          seen: loadSeen(),
          avoidSeen: loadAvoidSeen(),
        }),
      );
    } catch {
      setError('Could not load those categories. Check your connection and try again.');
      setDealing(null);
    }
  };

  const surprise = () => {
    const ids = surpriseCategories(PER_ROUND * 2);
    void deal('surprise', 'Surprise board', ids.slice(0, PER_ROUND), ids.slice(PER_ROUND));
  };

  const busy = dealing !== null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="font-pixel text-xs uppercase leading-snug tracking-wide text-neon-cyan">
          Start empty
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile
            title="Blank board"
            blurb="Write every clue yourself."
            disabled={busy}
            onClick={() => onCreate(createEmptyBoard())}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-pixel text-xs uppercase leading-snug tracking-wide text-neon-cyan">
            Deal one from the library
          </h3>
          <div className="flex gap-2" role="group" aria-label="Rounds">
            <button
              type="button"
              aria-pressed={format === 'full'}
              className={
                format === 'full'
                  ? 'btn-primary px-3 py-1 text-base'
                  : 'btn-secondary px-3 py-1 text-base'
              }
              onClick={() => setFormat('full')}
            >
              2 rounds
            </button>
            <button
              type="button"
              aria-pressed={format === 'quick'}
              className={
                format === 'quick'
                  ? 'btn-primary px-3 py-1 text-base'
                  : 'btn-secondary px-3 py-1 text-base'
              }
              onClick={() => setFormat('quick')}
            >
              1 round
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {RECIPES.map((recipe) => (
            <Tile
              key={recipe.id}
              title={recipe.title}
              blurb={dealing === recipe.id ? 'Dealing…' : recipe.blurb}
              disabled={busy}
              onClick={() => void deal(recipe.id, recipe.title, recipe.round1, recipe.round2)}
            />
          ))}
          <Tile
            title="🎲 Surprise me"
            blurb={dealing === 'surprise' ? 'Dealing…' : 'Categories picked at random.'}
            disabled={busy}
            onClick={surprise}
          />
        </div>
        <p className="text-lg text-white/60">
          Clues are dealt fresh each time, easy at the top and harder lower down. Click a column's
          name afterwards to swap its category.
        </p>
      </section>

      {error ? (
        <p role="alert" className="bg-buzz-out/25 p-3 text-lg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
