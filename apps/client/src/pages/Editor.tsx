import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  MAX_CATEGORIES_PER_ROUND,
  MAX_CLUES_PER_CATEGORY,
  boardDraftSchema,
  boardSchema,
  countClues,
  createEmptyRound,
  defaultClueValue,
  describeBoardIssues,
  makeId,
} from '@jeopardy/shared';
import type { Board, Clue } from '@jeopardy/shared';
import { CategoryPicker } from '../components/CategoryPicker';
import { useModal } from '../components/Modal';
import { NewBoardModal } from '../components/NewBoardModal';
import { PlayedClues } from '../components/PlayedClues';
import { SlideLink } from '../components/SlideLink';
import { DailyDoubleBadge } from '../components/Studio';
import { downloadBoard, loadBoards, sampleBoard, saveBoards } from '../lib/boards';
import { formatMoney } from '../lib/format';
import { hostGame } from '../lib/hostGame';
import { useSlideNavigate } from '../lib/slide';
import {
  applyCategory,
  drawFinal,
  redealDailyDoubles,
  redrawCell,
  redrawColumn,
} from '../library/build';
import { findCategory, findCategoryByName } from '../library/catalog';
import { FINALS, loadPack } from '../library/loader';
import { loadAvoidSeen, loadSeen } from '../library/seen';

type Tab = { kind: 'round'; index: number } | { kind: 'final' };
type Cell = { category: number; clue: number };
type Update = (edit: (draft: Board) => void) => void;
/** The column whose category is being picked. */
type Column = { round: number; column: number };

const hasText = (clue: Clue) => clue.clue.trim() !== '' || clue.answer.trim() !== '';

export function Editor() {
  const navigate = useSlideNavigate();
  const [initial] = useState(() => loadBoards());
  const [boards, setBoards] = useState<Board[]>(initial);
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>({ kind: 'round', index: 0 });
  const [cell, setCell] = useState<Cell | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [hosting, setHosting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState<Column | null>(null);
  const [dealing, setDealing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { confirm } = useModal();

  const board = boards.find((b) => b.id === selectedId) ?? null;
  const issues = useMemo(() => (board ? describeBoardIssues(board) : []), [board]);

  /** Every change goes through here, so the browser always has the latest copy (autosave). */
  const commit = (next: Board[], nextSelected = selectedId) => {
    setBoards(next);
    setSelectedId(nextSelected);
    setSaveFailed(!saveBoards(next));
  };

  const replace = (draft: Board) => commit(boards.map((b) => (b.id === draft.id ? draft : b)));

  const update: Update = (edit) => {
    if (!board) return;
    const draft = structuredClone(board);
    edit(draft);
    replace(draft);
  };

  const select = (id: string) => {
    setSelectedId(id);
    setTab({ kind: 'round', index: 0 });
    setCell(null);
    setMessage(null);
  };

  const addBoard = (next: Board) => {
    commit([...boards, next], next.id);
    setTab({ kind: 'round', index: 0 });
    setCell(null);
  };

  const duplicate = () => {
    if (!board) return;
    addBoard({ ...structuredClone(board), id: makeId(), title: `${board.title} (copy)` });
  };

  const remove = async () => {
    if (!board) return;
    const ok = await confirm({
      title: `Delete “${board.title.trim() || 'Untitled board'}”?`,
      message: "This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const rest = boards.filter((b) => b.id !== board.id);
    commit(rest, rest[0]?.id ?? '');
    setCell(null);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = boardDraftSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        setMessage({
          tone: 'error',
          text: `That file isn't a board: ${first ? `${first.path.join('.')} ${first.message}` : 'invalid'}`,
        });
        return;
      }
      const imported = parsed.data;
      const id = boards.some((b) => b.id === imported.id) ? makeId() : imported.id;
      addBoard({ ...imported, id });
      setMessage({ tone: 'info', text: `Imported "${imported.title || 'Untitled board'}".` });
    } catch {
      setMessage({ tone: 'error', text: "That file isn't valid JSON." });
    }
  };

  const host = async () => {
    if (!board || issues.length > 0) return;
    setHosting(true);
    const result = await hostGame(boardSchema.parse(board));
    setHosting(false);
    if (!result.ok) {
      setMessage({ tone: 'error', text: result.error });
      return;
    }
    navigate(`/host/${result.code}`, { state: { boardError: result.boardError } });
  };

  /** Draw another clue (or a whole column) from the library, for categories that came from it. */
  const redraw = async (roundIndex: number, column: number, row?: number) => {
    const name = board?.rounds[roundIndex]?.categories[column]?.name ?? '';
    const info = findCategoryByName(name);
    if (!board || !info) return;
    try {
      const pack = await loadPack(info.id);
      const draft = structuredClone(board);
      const options = { seen: loadSeen(), avoidSeen: loadAvoidSeen() };
      const changed =
        row === undefined
          ? redrawColumn(draft, pack, roundIndex, column, options) > 0
          : redrawCell(draft, pack, roundIndex, column, row, options);
      if (!changed) {
        setMessage({ tone: 'info', text: `${info.name} has no other clues to offer here.` });
        return;
      }
      setMessage(null);
      replace(draft);
    } catch {
      setMessage({ tone: 'error', text: `Could not load ${info.name}.` });
    }
  };

  const pickedColumn = picking
    ? board?.rounds[picking.round]?.categories[picking.column]
    : undefined;

  /** Library categories already on the board, so the picker can grey them out. */
  const takenCategories = () => {
    const taken = new Set<string>();
    for (const round of board?.rounds ?? []) {
      for (const category of round.categories) {
        const info = findCategoryByName(category.name);
        if (info) taken.add(info.id);
      }
    }
    return taken;
  };

  /** Put a library category into the column being picked, replacing its clues. */
  const chooseLibrary = async (id: string) => {
    const info = findCategory(id);
    if (!board || !picking || !pickedColumn || !info) return;
    const rows = pickedColumn.clues.length;
    // Clues from the library are cheap to get back. Ones the host wrote are not.
    if (!findCategoryByName(pickedColumn.name) && pickedColumn.clues.some(hasText)) {
      const ok = await confirm({
        title: 'Replace this column?',
        message: `The clues you wrote here will be replaced with ones from ${info.name}.`,
        confirmLabel: 'Replace',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setDealing(true);
    try {
      const pack = await loadPack(id);
      const draft = structuredClone(board);
      const options = { seen: loadSeen(), avoidSeen: loadAvoidSeen() };
      const filled = applyCategory(draft, pack, info.name, picking.round, picking.column, options);
      replace(draft);
      setMessage(
        filled < rows
          ? {
              tone: 'info',
              text: `${info.name} could only fill ${filled} of ${rows} rows. The dashed tiles need a clue.`,
            }
          : null,
      );
    } catch {
      setMessage({ tone: 'error', text: `Could not load ${info.name}.` });
    } finally {
      setDealing(false);
      setPicking(null);
    }
  };

  /** Name the column yourself, and optionally empty its clues. */
  const chooseCustom = (name: string, clearClues: boolean) => {
    if (!picking) return;
    update((d) => {
      const category = d.rounds[picking.round]?.categories[picking.column];
      if (!category) return;
      category.name = name;
      if (clearClues) {
        for (const clue of category.clues) {
          clue.clue = '';
          clue.answer = '';
        }
      }
    });
    setPicking(null);
  };

  /** Swap the Final Jeopardy clue for one from the library. */
  const drawFinalClue = async () => {
    if (!board) return;
    const { final } = board;
    const ownClue =
      (final.clue.trim() !== '' || final.answer.trim() !== '') &&
      !FINALS.some((f) => f.clue === final.clue);
    if (ownClue) {
      const ok = await confirm({
        title: 'Replace the Final clue?',
        message: 'The one you wrote will be replaced with a clue from the library.',
        confirmLabel: 'Replace',
        tone: 'danger',
      });
      if (!ok) return;
    }
    const draft = structuredClone(board);
    if (!drawFinal(draft, FINALS, { seen: loadSeen(), avoidSeen: loadAvoidSeen() })) {
      setMessage({ tone: 'info', text: 'The library has no other Final clue to offer.' });
      return;
    }
    setMessage(null);
    replace(draft);
  };

  const selectedClue =
    board && tab.kind === 'round' && cell
      ? board.rounds[tab.index]?.categories[cell.category]?.clues[cell.clue]
      : undefined;

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-b-[3px] border-[#1c2a70] bg-studio-deep/90 p-4 lg:w-72 lg:border-b-0 lg:border-r-[3px]">
        <div className="flex items-center justify-between">
          <SlideLink to="/" className="text-xl uppercase text-neon-cyan hover:text-white">
            ← Home
          </SlideLink>
          <h1 className="font-pixel text-base uppercase text-bulb chroma-text-sm">Boards</h1>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn-primary px-3 py-2" onClick={() => setCreating(true)}>
            New
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2"
            title="Add a board from a JSON file"
            onClick={() => fileInput.current?.click()}
          >
            Import
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={importFile}
          />
        </div>
        <ul className="flex flex-col gap-4">
          {boards.map((b) => {
            const problems = describeBoardIssues(b).length;
            const selected = b.id === selectedId;
            return (
              <li
                key={b.id}
                className={`transition pixel-frame ${
                  selected ? 'bg-bulb text-studio-deep' : 'bg-royal-used hover:bg-royal'
                }`}
              >
                <button
                  type="button"
                  onClick={() => select(b.id)}
                  aria-current={selected}
                  className="w-full px-3 py-2 text-left"
                >
                  <div className="truncate text-xl uppercase leading-tight">
                    {b.title || 'Untitled board'}
                  </div>
                  <div className="text-base opacity-75">
                    {countClues(b)} clues · {problems === 0 ? 'ready' : `${problems} to fix`}
                  </div>
                </button>
                {/* What you can do to a board lives on the board. Delete sits apart, at the far end. */}
                {selected ? (
                  <div className="flex items-stretch gap-2 px-3 pb-3 pt-1">
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-sm"
                      title="Download this board as a JSON file"
                      onClick={() => downloadBoard(b)}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-sm"
                      title="Make a copy of this board"
                      onClick={duplicate}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="btn-bad ml-auto px-2 py-1 text-sm"
                      aria-label="Delete board"
                      title="Delete board"
                      onClick={remove}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!boards.some((b) => b.id === sampleBoard.id) ? (
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            onClick={() => addBoard(structuredClone(sampleBoard))}
          >
            Restore sample board
          </button>
        ) : null}
        <div className="mt-auto flex flex-col gap-4">
          <PlayedClues />
          <p className="text-base text-white/50">
            Boards autosave in this browser.{' '}
            {saveFailed ? (
              <strong className="text-neon-pink">
                Saving failed. Export your board to keep it.
              </strong>
            ) : null}
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        {!board ? (
          <div className="mx-auto mt-20 max-w-sm text-center text-white/70">
            No board selected. Create one or import a JSON file.
          </div>
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-5">
            {/* A grid, so the button is exactly as tall as the title field beside it. */}
            <div className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label
                htmlFor="board-title"
                className="text-xs uppercase tracking-widest text-white/60 sm:col-span-2"
              >
                Board title
              </label>
              <input
                id="board-title"
                className="field text-2xl"
                value={board.title}
                onChange={(event) => update((d) => void (d.title = event.target.value))}
                placeholder="Friday trivia night"
              />
              <button
                type="button"
                className="btn-primary max-sm:mt-2"
                disabled={issues.length > 0 || hosting}
                title={issues.length > 0 ? 'Fix the problems first' : undefined}
                onClick={host}
              >
                {hosting ? 'Creating…' : 'Host a game'}
              </button>
            </div>

            {message ? (
              <p
                role={message.tone === 'error' ? 'alert' : 'status'}
                className={`p-3 text-lg ${message.tone === 'error' ? 'bg-buzz-out/25' : 'bg-buzz-open/25'}`}
              >
                {message.text}
              </p>
            ) : null}

            <nav className="flex flex-wrap gap-3" aria-label="Rounds">
              {board.rounds.map((round, index) => (
                <button
                  key={index}
                  type="button"
                  className={
                    tab.kind === 'round' && tab.index === index
                      ? 'btn-primary px-4 py-2'
                      : 'btn-secondary px-4 py-2'
                  }
                  onClick={() => {
                    setTab({ kind: 'round', index });
                    setCell(null);
                  }}
                >
                  {round.name || `Round ${index + 1}`}
                </button>
              ))}
              {board.rounds.length < 2 ? (
                <button
                  type="button"
                  className="btn-secondary px-4 py-2"
                  onClick={() =>
                    update((d) => void d.rounds.push(createEmptyRound(1, 'Double Jeepy!')))
                  }
                >
                  + Double Jeepy! round
                </button>
              ) : null}
              <button
                type="button"
                className={
                  tab.kind === 'final' ? 'btn-primary px-4 py-2' : 'btn-secondary px-4 py-2'
                }
                onClick={() => {
                  setTab({ kind: 'final' });
                  setCell(null);
                }}
              >
                Final Jeepy!
              </button>
            </nav>

            {tab.kind === 'final' ? (
              <FinalEditor board={board} update={update} onDraw={() => void drawFinalClue()} />
            ) : board.rounds[tab.index] ? (
              <RoundEditor
                board={board}
                roundIndex={tab.index}
                cell={cell}
                onSelect={setCell}
                update={update}
                onPickCategory={(column) => setPicking({ round: tab.index, column })}
                onRedrawColumn={(column) => void redraw(tab.index, column)}
                onRemoveRound={() => {
                  setTab({ kind: 'round', index: 0 });
                  setCell(null);
                  update((d) => void d.rounds.splice(tab.index, 1));
                }}
              />
            ) : null}

            {selectedClue && cell && tab.kind === 'round' ? (
              <ClueEditor
                key={`${tab.index}-${cell.category}-${cell.clue}`}
                title={`${board.rounds[tab.index]?.categories[cell.category]?.name || `Category ${cell.category + 1}`}`}
                clue={selectedClue}
                onRedraw={
                  findCategoryByName(board.rounds[tab.index]?.categories[cell.category]?.name ?? '')
                    ? () => void redraw(tab.index, cell.category, cell.clue)
                    : undefined
                }
                onChange={(edit) =>
                  update((d) => {
                    const target = d.rounds[tab.index]?.categories[cell.category]?.clues[cell.clue];
                    if (target) edit(target);
                  })
                }
              />
            ) : null}

            <details className="card" open={issues.length > 0 && issues.length <= 12}>
              <summary className="cursor-pointer text-xl uppercase">
                {issues.length === 0
                  ? 'Board is ready to play ✓'
                  : `${issues.length} thing${issues.length === 1 ? '' : 's'} to fix before you can host`}
              </summary>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-lg text-white/80">
                {issues.slice(0, 40).map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
                {issues.length > 40 ? <li>…and {issues.length - 40} more</li> : null}
              </ul>
            </details>
          </div>
        )}
      </main>

      <NewBoardModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(next) => {
          addBoard(next);
          setMessage(null);
          setCreating(false);
        }}
      />
      <CategoryPicker
        open={picking !== null && pickedColumn !== undefined}
        onClose={() => setPicking(null)}
        where={
          picking && board
            ? `${board.rounds[picking.round]?.name || `Round ${picking.round + 1}`} · column ${picking.column + 1}`
            : ''
        }
        currentName={pickedColumn?.name ?? ''}
        hasClues={pickedColumn?.clues.some(hasText) ?? false}
        taken={takenCategories()}
        busy={dealing}
        onLibrary={(id) => void chooseLibrary(id)}
        onCustom={chooseCustom}
      />
    </div>
  );
}

/** A pixel-art trash can that takes its colour and size (one line of text tall) from the button. */
function TrashIcon() {
  return (
    <svg viewBox="0 0 12 14" className="h-[1em] w-auto" fill="currentColor" aria-hidden>
      <path shapeRendering="crispEdges" d="M4 0h4v1H4zM0 1h12v2H0z" />
      {/* The can, with a slit either side of the middle. */}
      <path shapeRendering="crispEdges" fillRule="evenodd" d="M2 4h8v10H2zM4 6h1v6H4zM7 6h1v6H7z" />
    </svg>
  );
}

function isComplete(clue: Clue): boolean {
  return clue.clue.trim() !== '' && clue.answer.trim() !== '';
}

function RoundEditor({
  board,
  roundIndex,
  cell,
  onSelect,
  update,
  onPickCategory,
  onRedrawColumn,
  onRemoveRound,
}: {
  board: Board;
  roundIndex: number;
  cell: Cell | null;
  onSelect: (cell: Cell | null) => void;
  update: Update;
  onPickCategory: (column: number) => void;
  onRedrawColumn: (column: number) => void;
  onRemoveRound: () => void;
}) {
  const { confirm } = useModal();
  const round = board.rounds[roundIndex];
  if (!round) return null;
  const columns = round.categories.length;
  const rows = round.categories[0]?.clues.length ?? 0;

  const editRound = (edit: (draft: Board['rounds'][number]) => void) =>
    update((d) => {
      const target = d.rounds[roundIndex];
      if (target) edit(target);
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-col gap-1">
          <span className="text-xs uppercase tracking-widest text-white/60">Round name</span>
          <input
            className="field"
            value={round.name}
            onChange={(event) => editRound((r) => void (r.name = event.target.value))}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            disabled={columns <= 1}
            onClick={() => {
              onSelect(null);
              editRound((r) => void r.categories.pop());
            }}
          >
            − Category
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            disabled={columns >= MAX_CATEGORIES_PER_ROUND}
            onClick={() =>
              editRound((r) =>
                r.categories.push({
                  name: '',
                  clues: Array.from({ length: rows }, (_, i) => ({
                    value: defaultClueValue(roundIndex, i),
                    clue: '',
                    answer: '',
                  })),
                }),
              )
            }
          >
            + Category
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            disabled={rows <= 1}
            onClick={() => {
              onSelect(null);
              editRound((r) => r.categories.forEach((c) => void c.clues.pop()));
            }}
          >
            − Row
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            disabled={rows >= MAX_CLUES_PER_CATEGORY}
            onClick={() =>
              editRound((r) =>
                r.categories.forEach((c) =>
                  c.clues.push({
                    value: defaultClueValue(roundIndex, c.clues.length),
                    clue: '',
                    answer: '',
                  }),
                ),
              )
            }
          >
            + Row
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 text-sm"
            title={`Clear this round's Daily Doubles and place ${roundIndex === 0 ? 'one' : 'two'} fresh in the lower rows`}
            onClick={() => update((d) => redealDailyDoubles(d, roundIndex))}
          >
            🎲 Daily Doubles
          </button>
          {roundIndex === 1 ? (
            <button
              type="button"
              className="btn-bad px-3 py-2 text-sm"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Remove round?',
                  message: `"${round.name || 'Round 2'}" and all its clues will be removed from this board.`,
                  confirmLabel: 'Remove',
                  tone: 'danger',
                });
                if (ok) onRemoveRound();
              }}
            >
              Remove round
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div
          className="grid min-w-[760px] gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {round.categories.map((category, c) => (
            <button
              key={`name${c}`}
              type="button"
              aria-haspopup="dialog"
              aria-label={`Category ${c + 1}: ${category.name || 'not chosen yet'}. Change it`}
              title="Pick a category from the library, or name it yourself"
              className={`field flex min-h-16 cursor-pointer items-center justify-center gap-1 bg-royal-deep px-2 text-center text-base uppercase leading-tight hover:brightness-125 ${
                category.name ? '' : 'text-white/45'
              }`}
              onClick={() => onPickCategory(c)}
            >
              <span className="break-words">{category.name || `Category ${c + 1}`}</span>
              <span aria-hidden className="shrink-0 text-white/50">
                ▾
              </span>
            </button>
          ))}
          {Array.from({ length: rows }, (_, k) =>
            round.categories.map((category, c) => {
              const clue = category.clues[k];
              if (!clue) return <div key={`${c}-${k}`} />;
              const selected = cell?.category === c && cell.clue === k;
              return (
                <button
                  key={`${c}-${k}`}
                  type="button"
                  onClick={() => onSelect({ category: c, clue: k })}
                  className={`relative flex h-24 flex-col items-center justify-center gap-2 px-2 text-center transition hover:brightness-125 ${
                    isComplete(clue)
                      ? 'pixel-tile'
                      : 'pixel-tile-used outline-dashed outline-2 -outline-offset-4 outline-neon-pink/70'
                  } ${selected ? 'outline-solid outline-4 outline-offset-[3px] outline-bulb' : ''}`}
                  aria-label={`${category.name || `Category ${c + 1}`}, ${formatMoney(clue.value)}`}
                >
                  <span className="font-pixel text-base leading-none text-bulb pixel-drop-sm">
                    {formatMoney(clue.value)}
                  </span>
                  <span className="line-clamp-1 w-full text-base uppercase leading-none text-white/70">
                    {clue.clue || 'empty'}
                  </span>
                  {clue.dailyDouble ? <DailyDoubleBadge /> : null}
                </button>
              );
            }),
          )}
          {/* Under the tiles, so it's clear it swaps the whole column below its name. */}
          {round.categories.some((category) => findCategoryByName(category.name))
            ? round.categories.map((category, c) =>
                findCategoryByName(category.name) ? (
                  <button
                    key={`redraw${c}`}
                    type="button"
                    className="btn-secondary px-2 py-1 text-base"
                    title="Replace every clue in this column with fresh ones from the library"
                    onClick={() => onRedrawColumn(c)}
                  >
                    ↻ Reroll
                  </button>
                ) : (
                  <div key={`redraw${c}`} />
                ),
              )
            : null}
        </div>
      </div>
      <p className="text-base text-white/50">
        Click a category to pick one from the library or name your own. Click a tile to edit its
        clue. DD marks a Daily Double. Dashed tiles are missing a clue or answer.
      </p>
    </section>
  );
}

function ClueEditor({
  title,
  clue,
  onChange,
  onRedraw,
}: {
  title: string;
  clue: Clue;
  onChange: (edit: (clue: Clue) => void) => void;
  /** Present when the category came from the library. */
  onRedraw?: () => void;
}) {
  return (
    <section className="card flex flex-col gap-3">
      <h2 className="font-pixel text-base uppercase leading-snug text-bulb">
        {title} · {formatMoney(clue.value)}
      </h2>
      <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-widest text-white/60">Value</span>
          <input
            className="field"
            type="number"
            min={1}
            step={100}
            value={clue.value}
            onChange={(event) =>
              onChange(
                (c) => void (c.value = Math.max(1, Math.round(Number(event.target.value)) || 1)),
              )
            }
          />
        </label>
        <label className="flex items-end gap-3 pb-2">
          <input
            type="checkbox"
            className="h-6 w-6 accent-bulb"
            checked={clue.dailyDouble === true}
            onChange={(event) =>
              onChange((c) => {
                if (event.target.checked) c.dailyDouble = true;
                else delete c.dailyDouble;
              })
            }
          />
          <span>Daily Double</span>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-widest text-white/60">Clue (read aloud)</span>
        <textarea
          className="field min-h-24"
          value={clue.clue}
          onChange={(event) => onChange((c) => void (c.clue = event.target.value))}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-widest text-white/60">Answer (host only)</span>
        <input
          className="field"
          value={clue.answer}
          placeholder="What is…?"
          onChange={(event) => onChange((c) => void (c.answer = event.target.value))}
        />
      </label>
      {onRedraw ? (
        <button type="button" className="btn-secondary self-start" onClick={onRedraw}>
          ↻ Reroll this clue
        </button>
      ) : null}
    </section>
  );
}

function FinalEditor({
  board,
  update,
  onDraw,
}: {
  board: Board;
  update: Update;
  onDraw: () => void;
}) {
  return (
    <section className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-pixel text-base uppercase leading-snug text-bulb">Final Jeepy!</h2>
        <button
          type="button"
          className="btn-secondary px-3 py-2 text-sm"
          title="Replace the category, clue and answer with one from the library"
          onClick={onDraw}
        >
          🎲 Draw from the library
        </button>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-widest text-white/60">Category</span>
        <input
          className="field"
          value={board.final.category}
          onChange={(event) => update((d) => void (d.final.category = event.target.value))}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-widest text-white/60">Clue</span>
        <textarea
          className="field min-h-24"
          value={board.final.clue}
          onChange={(event) => update((d) => void (d.final.clue = event.target.value))}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-widest text-white/60">Answer (host only)</span>
        <input
          className="field"
          value={board.final.answer}
          onChange={(event) => update((d) => void (d.final.answer = event.target.value))}
        />
      </label>
    </section>
  );
}
