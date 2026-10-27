import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  MAX_CATEGORIES_PER_ROUND,
  MAX_CLUES_PER_CATEGORY,
  boardDraftSchema,
  boardSchema,
  countClues,
  createEmptyBoard,
  createEmptyRound,
  defaultClueValue,
  describeBoardIssues,
  makeId,
} from '@jeopardy/shared';
import type { Board, Clue } from '@jeopardy/shared';
import { downloadBoard, loadBoards, sampleBoard, saveBoards } from '../lib/boards';
import { formatMoney } from '../lib/format';
import { hostGame } from '../lib/hostGame';

type Tab = { kind: 'round'; index: number } | { kind: 'final' };
type Cell = { category: number; clue: number };
type Update = (edit: (draft: Board) => void) => void;

export function Editor() {
  const navigate = useNavigate();
  const [initial] = useState(() => loadBoards());
  const [boards, setBoards] = useState<Board[]>(initial);
  const [selectedId, setSelectedId] = useState(initial[0]?.id ?? '');
  const [tab, setTab] = useState<Tab>({ kind: 'round', index: 0 });
  const [cell, setCell] = useState<Cell | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [hosting, setHosting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const board = boards.find((b) => b.id === selectedId) ?? null;
  const issues = useMemo(() => (board ? describeBoardIssues(board) : []), [board]);

  /** Every change goes through here, so the browser always has the latest copy (autosave). */
  const commit = (next: Board[], nextSelected = selectedId) => {
    setBoards(next);
    setSelectedId(nextSelected);
    setSaveFailed(!saveBoards(next));
  };

  const update: Update = (edit) => {
    if (!board) return;
    const draft = structuredClone(board);
    edit(draft);
    commit(boards.map((b) => (b.id === board.id ? draft : b)));
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

  const remove = () => {
    if (!board || !window.confirm(`Delete "${board.title || 'Untitled board'}"?`)) return;
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

  const selectedClue =
    board && tab.kind === 'round' && cell
      ? board.rounds[tab.index]?.categories[cell.category]?.clues[cell.clue]
      : undefined;

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-3 border-b border-white/10 bg-black/25 p-4 lg:w-72 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-sm text-gold underline">
            ← Home
          </Link>
          <h1 className="font-display text-2xl uppercase text-gold">Boards</h1>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-primary px-3 py-2"
            onClick={() => addBoard(createEmptyBoard())}
          >
            New
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2"
            onClick={() => fileInput.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={importFile}
          />
        </div>
        <ul className="flex flex-col gap-1.5">
          {boards.map((b) => {
            const problems = describeBoardIssues(b).length;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => select(b.id)}
                  className={`w-full rounded-xl px-3 py-2 text-left transition ${
                    b.id === selectedId
                      ? 'bg-gold text-board-deep'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <div className="truncate font-semibold">{b.title || 'Untitled board'}</div>
                  <div className="text-xs opacity-70">
                    {countClues(b)} clues · {problems === 0 ? 'ready ✓' : `${problems} to fix`}
                  </div>
                </button>
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
        <p className="mt-auto text-xs text-white/50">
          Boards autosave in this browser.{' '}
          {saveFailed ? (
            <strong className="text-red-300">Saving failed. Export your board to keep it.</strong>
          ) : null}
        </p>
      </aside>

      <main className="min-w-0 flex-1 p-4 lg:p-6">
        {!board ? (
          <div className="mx-auto mt-20 max-w-sm text-center text-white/70">
            No board selected. Create one or import a JSON file.
          </div>
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col gap-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[240px] flex-1 flex-col gap-1">
                <span className="text-xs uppercase tracking-widest text-white/60">Board title</span>
                <input
                  className="field text-xl font-bold"
                  value={board.title}
                  onChange={(event) => update((d) => void (d.title = event.target.value))}
                  placeholder="Friday trivia night"
                />
              </label>
              <button type="button" className="btn-secondary" onClick={() => downloadBoard(board)}>
                Export JSON
              </button>
              <button type="button" className="btn-secondary" onClick={duplicate}>
                Duplicate
              </button>
              <button type="button" className="btn-secondary text-red-300" onClick={remove}>
                Delete
              </button>
              <button
                type="button"
                className="btn-primary"
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
                className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-buzz-out/25' : 'bg-buzz-open/25'}`}
              >
                {message.text}
              </p>
            ) : null}

            <nav className="flex flex-wrap gap-2" aria-label="Rounds">
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
                    update((d) => void d.rounds.push(createEmptyRound(1, 'Double Jeopardy!')))
                  }
                >
                  + Double Jeopardy round
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
                Final Jeopardy
              </button>
            </nav>

            {tab.kind === 'final' ? (
              <FinalEditor board={board} update={update} />
            ) : board.rounds[tab.index] ? (
              <RoundEditor
                board={board}
                roundIndex={tab.index}
                cell={cell}
                onSelect={setCell}
                update={update}
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
                onChange={(edit) =>
                  update((d) => {
                    const target = d.rounds[tab.index]?.categories[cell.category]?.clues[cell.clue];
                    if (target) edit(target);
                  })
                }
              />
            ) : null}

            <details className="card" open={issues.length > 0 && issues.length <= 12}>
              <summary className="cursor-pointer text-sm font-semibold">
                {issues.length === 0
                  ? 'Board is ready to play ✓'
                  : `${issues.length} thing${issues.length === 1 ? '' : 's'} to fix before you can host`}
              </summary>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
                {issues.slice(0, 40).map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
                {issues.length > 40 ? <li>…and {issues.length - 40} more</li> : null}
              </ul>
            </details>
          </div>
        )}
      </main>
    </div>
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
  onRemoveRound,
}: {
  board: Board;
  roundIndex: number;
  cell: Cell | null;
  onSelect: (cell: Cell | null) => void;
  update: Update;
  onRemoveRound: () => void;
}) {
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
        <div className="flex flex-wrap gap-2">
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
            title="Set every value back to the default for this round"
            onClick={() =>
              editRound((r) =>
                r.categories.forEach((c) =>
                  c.clues.forEach((clue, i) => void (clue.value = defaultClueValue(roundIndex, i))),
                ),
              )
            }
          >
            Reset values
          </button>
          {roundIndex === 1 ? (
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-sm text-red-300"
              onClick={() => {
                if (window.confirm('Remove this round and all its clues?')) onRemoveRound();
              }}
            >
              Remove round
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div
          className="grid min-w-[760px] gap-1.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {round.categories.map((category, c) => (
            <input
              key={`name${c}`}
              className="field rounded-md bg-board text-center text-sm font-bold uppercase"
              value={category.name}
              placeholder={`Category ${c + 1}`}
              aria-label={`Category ${c + 1} name`}
              onChange={(event) =>
                editRound((r) => {
                  const target = r.categories[c];
                  if (target) target.name = event.target.value;
                })
              }
            />
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
                  className={`relative flex h-20 flex-col items-center justify-center rounded-md px-1 text-center transition ${
                    isComplete(clue)
                      ? 'bg-board'
                      : 'bg-white/10 outline-dashed outline-1 outline-red-300/60'
                  } ${selected ? 'ring-2 ring-gold' : 'hover:bg-board-light'}`}
                  aria-label={`${category.name || `Category ${c + 1}`}, ${formatMoney(clue.value)}`}
                >
                  <span className="font-display text-2xl text-gold">{formatMoney(clue.value)}</span>
                  <span className="line-clamp-1 w-full text-[10px] text-white/70">
                    {clue.clue || 'empty'}
                  </span>
                  {clue.dailyDouble ? (
                    <span
                      className="absolute right-1 top-0.5 text-xs text-white"
                      title="Daily Double"
                    >
                      ★
                    </span>
                  ) : null}
                </button>
              );
            }),
          )}
        </div>
      </div>
      <p className="text-xs text-white/50">
        Click a tile to edit its clue. ★ marks a Daily Double. Dashed tiles are missing a clue or
        answer.
      </p>
    </section>
  );
}

function ClueEditor({
  title,
  clue,
  onChange,
}: {
  title: string;
  clue: Clue;
  onChange: (edit: (clue: Clue) => void) => void;
}) {
  return (
    <section className="card flex flex-col gap-3">
      <h2 className="font-display text-2xl uppercase text-gold">
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
            className="h-5 w-5 accent-yellow-400"
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
    </section>
  );
}

function FinalEditor({ board, update }: { board: Board; update: Update }) {
  return (
    <section className="card flex flex-col gap-3">
      <h2 className="font-display text-2xl uppercase text-gold">Final Jeopardy</h2>
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
