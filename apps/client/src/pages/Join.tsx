import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { NAME_MAX_LENGTH, ROOM_CODE_LENGTH } from '@jeopardy/shared';
import { ensureConnected, request } from '../lib/socket';
import { saveSession } from '../lib/session';

/** Codes are letters only and never contain I or O. Typing is forgiving, the server is strict. */
const cleanCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);

export function Join() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(cleanCode(params.get('code') ?? ''));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    if (!(await ensureConnected())) {
      setBusy(false);
      setError('Could not reach the server. Are you on the same Wi-Fi?');
      return;
    }
    const result = await request('room:join', { code, name });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    saveSession({ code, token: result.token, role: 'player', name: name.trim() });
    navigate(`/play/${code}`);
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-center font-display text-5xl uppercase tracking-wide text-gold board-text">
        Join a game
      </h1>
      <form onSubmit={submit} className="card flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-white/70">Room code</span>
          <input
            className="field text-center font-mono text-4xl uppercase tracking-[0.4em]"
            value={code}
            onChange={(event) => setCode(cleanCode(event.target.value))}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD"
            maxLength={ROOM_CODE_LENGTH}
            autoFocus={!code}
            aria-label="Room code"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-white/70">Your name</span>
          <input
            className="field text-lg"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            placeholder="Alex"
            autoFocus={code.length === ROOM_CODE_LENGTH}
          />
        </label>
        {error ? (
          <p role="alert" className="rounded-lg bg-buzz-out/20 p-3 text-sm">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn-primary text-lg"
          disabled={busy || code.length !== ROOM_CODE_LENGTH || name.trim().length === 0}
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>
      <Link to="/" className="text-center text-sm text-white/60 underline">
        Back
      </Link>
    </main>
  );
}
