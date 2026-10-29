import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NAME_MAX_LENGTH, ROOM_CODE_LENGTH } from '@jeopardy/shared';
import { SlideLink } from '../components/SlideLink';
import { StudioBackdrop } from '../components/Studio';
import { ensureConnected, request } from '../lib/socket';
import { saveSession } from '../lib/session';
import { useSlideNavigate } from '../lib/slide';

/** Codes are letters only and never contain I or O. Typing is forgiving, the server is strict. */
const cleanCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);

export function Join() {
  const navigate = useSlideNavigate();
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
    <StudioBackdrop audience>
      {/* The bottom padding keeps the form clear of the studio audience. */}
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 pb-48 pt-10">
        <h1 className="text-center font-pixel text-2xl uppercase leading-snug text-bulb chroma-text">
          Join a game
        </h1>
        <form onSubmit={submit} className="card flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-base uppercase tracking-widest text-white/60">Room code</span>
            <input
              className="field py-4 text-center font-pixel text-4xl uppercase tracking-[0.3em]"
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
          <label className="flex flex-col gap-2">
            <span className="text-base uppercase tracking-widest text-white/60">Your name</span>
            <input
              className="field text-2xl"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={NAME_MAX_LENGTH}
              autoComplete="nickname"
              placeholder="Alex"
              autoFocus={code.length === ROOM_CODE_LENGTH}
            />
          </label>
          {error ? (
            <p role="alert" className="bg-buzz-out/25 p-3 text-lg">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn-primary text-2xl"
            disabled={busy || code.length !== ROOM_CODE_LENGTH || name.trim().length === 0}
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        </form>
        <SlideLink to="/" className="text-center text-xl uppercase text-white/60 hover:text-white">
          ◀ Back
        </SlideLink>
      </main>
    </StudioBackdrop>
  );
}
