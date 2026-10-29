import { useMemo, useState } from 'react';
import { CATEGORIES, GROUPS, findCategoryByName } from '../library/catalog';
import { surpriseCategories } from '../library/deal';
import { Modal } from './Modal';

export interface CategoryPickerProps {
  open: boolean;
  onClose: () => void;
  /** Which column this is for, such as "Round 1 · column 3". */
  where: string;
  /** What the column is called now. */
  currentName: string;
  /** Whether the column has any clue text in it. */
  hasClues: boolean;
  /** Ids of the library categories already on the board, this column's included. They can't be picked again. */
  taken: ReadonlySet<string>;
  /** A category is being dealt: hold still until it lands. */
  busy: boolean;
  onLibrary: (id: string) => void;
  onCustom: (name: string, clearClues: boolean) => void;
}

/** Click a column's name to land here: pick a library category, or name the column yourself. */
export function CategoryPicker({ open, onClose, ...body }: CategoryPickerProps) {
  return (
    <Modal
      wide
      open={open}
      title="Pick a category"
      onClose={onClose}
      actions={
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      }
    >
      {/* Mounted only while open, so the search and the tab start fresh each time. */}
      {open ? <PickerBody {...body} /> : null}
    </Modal>
  );
}

type Tab = 'library' | 'custom';

function PickerBody({
  where,
  currentName,
  hasClues,
  taken,
  busy,
  onLibrary,
  onCustom,
}: Omit<CategoryPickerProps, 'open' | 'onClose'>) {
  const currentId = findCategoryByName(currentName)?.id;
  const fromLibrary = currentId !== undefined;
  const [tab, setTab] = useState<Tab>(
    currentName.trim() !== '' && !fromLibrary ? 'custom' : 'library',
  );
  const [query, setQuery] = useState('');
  const [name, setName] = useState(fromLibrary ? '' : currentName);
  // Library clues don't fit a new topic, so clearing them is the default. Hand-written ones stay.
  const [clear, setClear] = useState(fromLibrary);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      CATEGORIES.filter(
        (c) => needle === '' || `${c.name} ${c.blurb} ${c.group}`.toLowerCase().includes(needle),
      ),
    [needle],
  );

  const surprise = () => {
    const [id] = surpriseCategories(1, Math.random, [...taken]);
    if (id) onLibrary(id);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-lg text-white/60">
        {where}
        {currentName.trim() !== '' ? ` · now “${currentName}”` : ''}
      </p>

      <div
        className="flex flex-wrap gap-3"
        role="tablist"
        aria-label="Where the category comes from"
      >
        {(['library', 'custom'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'btn-primary px-4 py-2' : 'btn-secondary px-4 py-2'}
            onClick={() => setTab(id)}
          >
            {id === 'library' ? `Library · ${CATEGORIES.length}` : 'Custom'}
          </button>
        ))}
      </div>

      {tab === 'library' ? (
        <>
          <div className="flex flex-wrap gap-3">
            <input
              className="field min-w-[12rem] flex-1"
              type="text"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search categories"
              aria-label="Search categories"
            />
            <button
              type="button"
              className="btn-secondary px-3 py-2"
              disabled={busy}
              onClick={surprise}
            >
              🎲 Surprise me
            </button>
          </div>

          {GROUPS.map((group) => {
            const inGroup = matches.filter((c) => c.group === group);
            if (inGroup.length === 0) return null;
            return (
              <section key={group} className="flex flex-col gap-2">
                <h3 className="font-pixel text-xs uppercase leading-snug tracking-wide text-neon-cyan">
                  {group}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {inGroup.map((c) => {
                    const here = c.id === currentId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={busy || taken.has(c.id)}
                        title={
                          here
                            ? 'Already in this column. Use ↻ Reroll there for fresh clues.'
                            : taken.has(c.id)
                              ? 'Already on this board'
                              : undefined
                        }
                        onClick={() => onLibrary(c.id)}
                        className={`tap-target flex flex-col gap-1 px-3 py-2 text-left transition pixel-frame disabled:cursor-not-allowed ${
                          here
                            ? 'bg-bulb text-studio-deep'
                            : 'bg-royal-used hover:bg-royal disabled:opacity-40 disabled:hover:bg-royal-used'
                        }`}
                      >
                        <span className="truncate text-xl uppercase leading-tight">{c.name}</span>
                        <span className="text-base opacity-75">{c.blurb}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {matches.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-lg text-white/70">
                Nothing in the library matches “{query.trim()}”.
              </p>
              <button
                type="button"
                className="btn-secondary px-3 py-2"
                onClick={() => {
                  setName(query.trim());
                  setTab('custom');
                }}
              >
                Use “{query.trim()}” as a custom name
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== '') onCustom(name.trim(), clear);
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-white/60">Category name</span>
            <input
              autoFocus
              className="field text-2xl uppercase"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your own category"
            />
          </label>
          {hasClues ? (
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={clear}
                  onChange={(event) => setClear(event.target.checked)}
                />
                <span>Clear this column's clues</span>
              </label>
              <p className="text-lg text-white/60">
                {fromLibrary
                  ? `They came from ${currentName}, so they won't fit a new topic.`
                  : 'Leave it off to keep the clues and only rename the column.'}
              </p>
            </div>
          ) : null}
          <button type="submit" className="btn-primary" disabled={name.trim() === ''}>
            Use this name
          </button>
        </form>
      )}
    </div>
  );
}
