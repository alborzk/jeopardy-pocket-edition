# Jeopardy Party App

Multiplayer Jeopardy for in-person game nights. The host creates a room and shows the board on a TV or laptop. Players join on their phones with a 4-letter room code. Each phone is a buzzer, and players also use it to wager and to write Final Jeopardy answers. The host builds boards ahead of time and runs the game from a controller view.

## Stack (don't substitute without asking)

- TypeScript everywhere, `strict: true`
- pnpm workspaces monorepo
- Server: current Node LTS, Socket.IO v4, and a plain `http` server (or Express) that also serves the built client
- Client: React + Vite + Tailwind CSS, React Router, `socket.io-client`
- Validation: zod on every incoming socket payload
- Tests: Vitest
- QR codes: `qrcode` (for the lobby join link)
- State: held in memory on the server. No database in v1.
- Deploy target: one long-running Node process (Fly.io, Railway or Render). Not serverless, because serverless can't hold websockets.

## Repo layout

```
packages/shared/   types, zod schemas, socket event contracts, constants
apps/server/       Socket.IO server, room manager, game reducer, timers, role-filtered views
apps/client/       React app (all views)
```

## Roles and views

| Route | Role | Typical device | Receives answers? | Purpose |
|---|---|---|---|---|
| `/` | anyone | any | — | Landing page: Host a game / Join a game |
| `/editor` | host | laptop | yes | Board editor |
| `/host/:code` | host | phone or laptop | yes | Game controller |
| `/display/:code` | display | TV / laptop | only after reveal | Big-screen board |
| `/join` → `/play/:code` | player | phone | no | Buzzer, wagers, Final answers |

## Rooms and reconnection

- Room codes are 4 uppercase letters, excluding I and O. Code input is case-insensitive.
- `room:create` returns `{ code, hostToken }`. A joining player gets `{ playerId, token }`. Store `{ code, token, role }` in localStorage.
- On every socket connect, if a saved token exists for the room, send `room:rejoin` and restore the client's role, name, score and lockouts. **Reconnection is a core feature, not polish.** Phones lock and drop sockets constantly.
- Disconnected players keep their seat and score, and the scoreboard shows them as disconnected.
- If the host disconnects, the game pauses (timers stop) until the host rejoins.
- Names are 1–16 characters and unique per room (case-insensitive). Maximum 12 players.
- Delete a room 30 minutes after its last client disconnects.
- Rely on our own token rejoin. Don't depend on Socket.IO's `connectionStateRecovery`.

## Board model

```ts
type Clue = { value: number; clue: string; answer: string; dailyDouble?: boolean };
type Category = { name: string; clues: Clue[] };        // usually 5 clues
type Round = { name: string; categories: Category[] };  // usually 6 categories
type Board = {
  id: string;
  title: string;
  rounds: Round[];                                       // 1 or 2 (Jeopardy, Double Jeopardy)
  final: { category: string; clue: string; answer: string };
};
```

- Editor: create and edit boards, toggle Daily Double on any clue, validate with zod, autosave to localStorage, import and export JSON files.
- Ship one sample board at `apps/client/src/sample-board.json`.
- Default values: round 1 is 200–1000, round 2 is 400–2000.
- When creating a room, the host picks a saved board and sends it with `host:loadBoard`.

## Game flow (server-side state machine)

- `lobby`: players join. The host loads a board and starts the game.
- `board`: the display shows the grid and highlights the player in control. The host selects the clue the player in control calls out aloud.
- `clue`: the clue shows on the display. Buzzers stay locked while the host reads it, then the host presses Open Buzzers.
- `buzzersOpen`: the first valid buzz wins and moves the game to `answering`. A configurable timeout (default 5s, can be turned off) moves to `reveal` if nobody buzzes.
- `answering`: the buzzed player answers aloud, and the host judges.
  - Correct: add the clue value, give that player control, go to `reveal`.
  - Incorrect: subtract the clue value and lock that player out for this clue. Return to `buzzersOpen` if anyone is still eligible, otherwise go to `reveal`.
- `reveal`: the display shows the answer. When the host continues, go to `board`, or to `roundEnd` if no clues remain.
- `dailyDoubleWager`: only the player in control takes part. They wager on their phone. The minimum is 5 and the maximum is max(their score, the top clue value in this round). Then `dailyDoubleClue`: the host judges, the score changes by ± the wager, and the game goes to `reveal`. No buzzers.
- `roundEnd`: show scores, then start the next round (control goes to the lowest score) or move to Final Jeopardy.
- `finalWager`: show the category. Players with a score above 0 wager from 0 up to their score on their phones. The host can choose to let everyone play.
- `finalAnswer`: show the clue and run a 30s server timer. Players type answers, and submissions lock at the deadline.
- `finalReveal`: the host reveals players one at a time, lowest score first. For each, show the answer, judge it correct or incorrect, then apply the wager.
- `gameOver`: show final standings.

At any point the host can adjust any score, skip a clue, undo the last action, kick a player, pause or resume, or end the game.

## Buzzer rules

- The server decides by the order it receives buzzes. Ignore client timestamps.
- A player who buzzes during `clue` (before buzzers open) is locked out until 250ms after the buzzers open.
- Players already judged incorrect on this clue can't buzz again.
- `player:buzz` uses an ack that returns `won | late | locked | notOpen`, so the phone reacts instantly.

## Socket contract

All client → server events are typed in `packages/shared` and validated with zod. Each one uses an ack that returns `{ ok: true, ... } | { ok: false, error: string }`. The server checks the sender's role and the current phase for every event.

Client → server:

- `room:create` → `{ code, hostToken }`
- `room:join { code, name }` → `{ playerId, token }`
- `room:rejoin { code, token }`
- `display:join { code }`
- `host:loadBoard { board }` (lobby only)
- `host:start`
- `host:selectClue { categoryIndex, clueIndex }`
- `host:openBuzzers`
- `host:judge { correct }`
- `host:continue` (advance from reveal, round end, etc.)
- `host:skipClue`
- `host:adjustScore { playerId, delta }`
- `host:undo`
- `host:kick { playerId }`
- `host:pause`, `host:resume`
- `host:finalReveal { playerId }`, `host:finalJudge { playerId, correct }`
- `player:buzz`
- `player:wager { amount }`
- `player:finalAnswer { text }`

Server → client:

- `state`: the full role-filtered snapshot, sent after every change. The state is small, so don't send diffs.

## Architecture rules

- Game logic is a pure reducer, `reduce(state, action, now) → state`, with no sockets, timers or I/O inside it. Unit-test it thoroughly.
- The room manager owns sockets and timers. On each event it runs the reducer, schedules or clears timers when the phase changes, then broadcasts.
- Store `deadline` timestamps (epoch ms) in state. Clients render countdowns from them, and server timers enforce them.
- `viewFor(state, role, playerId)` builds each client's snapshot.
  - The display and players never receive a clue's answer before the reveal.
  - They never see other players' Final wagers or answers before the host reveals them.
  - The host view includes everything.
  - Write tests for these filtering rules.
- Undo keeps the last 20 states per room.
- The server is the single source of truth. Clients never compute scores or phases themselves.

## UI notes

**Player phone (`/play/:code`)**
- Full-screen buzzer button triggered on `pointerdown`, not `click`. States: locked (grey), open (green), you're in (gold), locked out (red).
- Use `touch-action: manipulation` and disable text selection and double-tap zoom.
- Request a Screen Wake Lock while in a room, and request it again on `visibilitychange`.
- Call `navigator.vibrate` on buzz where it's supported.
- Show the player's name and score, plus a "Reconnecting…" banner when the socket drops.
- Wager input shows the min and max. The Final Jeopardy answer textarea shows a countdown and locks after submit.

**Display (`/display/:code`)**
- Classic look: deep blue tiles, gold dollar values, uppercase category headers. Design for 1920×1080 and include a fullscreen button.
- Lobby: big room code, join URL and QR code, and a live player list.
- Clue: full-screen clue text, the name of whoever buzzed, and a scoreboard strip.

**Host controller (`/host/:code`)**
- Designed for phones first.
- Shows the current clue and its answer, plus one obvious primary button for the next step in each phase.
- Scoreboard with +/− adjust buttons, player list with kick, and an undo button.

## Local development

- `pnpm dev` runs the server and client together.
- Run Vite with `--host`, and have Vite proxy `/socket.io` (with `ws: true`) to the server so dev is single-origin.
- On startup, print the LAN URL so phones on the same Wi-Fi can join.
- In production, the server serves `apps/client/dist` and the socket on one port. Include a Dockerfile.

## Build order

Stop after each phase so I can test before moving on.

1. Scaffold the monorepo, shared types, lint and format config, and a Socket.IO handshake between client and server.
2. Rooms: create, join, rejoin with tokens, lobby on the display with QR code, player list.
3. Board editor, JSON import/export, sample board.
4. Game reducer with Vitest tests covering selection, buzzing, judging, lockouts, Daily Double, round end and undo.
5. Wire up the host controller, display and player buzzer to play full rounds.
6. Final Jeopardy.
7. Polish: wake lock, vibration, pause, kick, room cleanup, Dockerfile.

## Out of scope for v1

Accounts, server-side board storage, multiple server instances, image and audio clues, sound effects.
