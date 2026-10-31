# Jeepy Party!

Multiplayer Jeopardy for in-person game nights: a buzzer in every pocket. The host shows the board
on a TV or laptop, players join on their phones with a 4-letter room code, and each phone is a
buzzer.

See [CLAUDE.md](CLAUDE.md) for the full spec this was built from.

## Run it

You need Node 22+ and pnpm 10 (`corepack enable`, or `npm install -g pnpm`).

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the game server (port 3001) and the Vite client (port 5173, proxying the
socket to the server so everything is one origin). It prints the address phones should use, for
example `http://192.168.1.20:5173`. Phones must be on the same Wi-Fi.

## Playing

1. **Host**: open the app, pick a board (a sample is included) and press **Create room**. You get
   the controller at `/host/CODE`, built for a phone. Boards are made in the editor at `/editor`.
2. **Display**: open the display link shown in the host lobby (`/display/CODE`) on the TV and press
   Fullscreen. It shows the room code and a QR code.
3. **Players**: scan the QR code or go to `/join` and type the room code and a name.

Phones that lock or lose signal come back into the game on their own: the browser keeps a token
for each room and rejoins on every reconnect, keeping the player's seat, score and lockouts.

## The category library

You don't have to write clues yourself: the board editor (`/editor`) can fill them in from a
library of 77 categories, each with 30 clues: six candidates for each of five difficulty tiers. A
board's rows draw from the matching tiers, so $200 is easy and $1,000 is hard, and the same
category gives different clues each time.

- **New** offers a blank board, a ready-made mix (Classic Mix, Nostalgia Night…) or **Surprise
  me**, in one round or two. The clues are dealt for you.
- **Click a column's name** to swap its category: pick one from the library (search it, or take a
  random one) or choose **Custom** and name the column yourself.
- The result is an ordinary board, saved with your others. Edit it, export it or host it as usual.
  **↻ Reroll** swaps a clue or a whole column for fresh ones from the same category, **🎲 Daily
  Doubles** re-rolls where they sit, and Final Jeepy! can draw its clue from the library too.
- **Unseen first**: the host's browser remembers which clues have been played and the library
  leads with ones it hasn't seen. Turn it off, or forget what's been played, at the bottom of the
  editor's sidebar. It's per browser, so a different host device starts fresh.
- Daily Doubles are placed for you (one in round one, two in round two, in the lower rows), and
  the library avoids putting two clues on a board that share an answer or give each other away.

To add a category, create `apps/client/src/library/categories/<id>.json` with five tiers of six
`["clue", "What is the answer?"]` pairs, easiest tier first, and add an entry to `catalog.ts`.
`pnpm test` checks the shape, the answer style, repeats, and answers that leak into their own clue.
If the tests don't notice a new file, delete `node_modules/.vitest-cache` and run them again.

## Scripts

| Command          | What it does                                             |
| ---------------- | -------------------------------------------------------- |
| `pnpm dev`       | Server and client with hot reload                        |
| `pnpm test`      | Vitest across all packages                               |
| `pnpm typecheck` | `tsc --noEmit` in every package                          |
| `pnpm lint`      | ESLint                                                   |
| `pnpm format`    | Prettier (`pnpm format:check` to only check)             |
| `pnpm build`     | Build the client, then bundle the server                 |
| `pnpm start`     | Run the built server, which also serves the built client |

## Layout

```
packages/shared/   types, zod schemas, socket event contracts, constants
apps/server/       Socket.IO server, room manager, game reducer, timers, role-filtered views
apps/client/       React app: landing, editor, host controller, display, player buzzer
```

The game rules are a pure reducer (`apps/server/src/game/reducer.ts`) with no sockets or timers.
The room manager owns the sockets and timers, runs the reducer for each event, then sends every
client its own role-filtered snapshot (`viewFor`). Clients never compute scores or phases.

## Deploying

One long-running Node process, because websockets and in-memory rooms don't fit serverless.
The included `Dockerfile` builds everything and runs `node apps/server/dist/index.js`.

```bash
docker build -t jeepy-party .
docker run -p 8080:8080 jeepy-party
```

| Variable      | Default   | Meaning                                   |
| ------------- | --------- | ----------------------------------------- |
| `PORT`        | `3001`    | Port to listen on (the image sets `8080`) |
| `HOST`        | `0.0.0.0` | Address to bind                           |
| `CLIENT_DIST` | built-in  | Folder holding the built client to serve  |

Run **one instance only**: rooms live in the server's memory, so a second instance can't see them.
A restart ends all games in progress.

### Render (free)

`render.yaml` describes the whole service: a single free web service built from the
`Dockerfile`, with `/healthz` as its health check.

1. Push this repo to GitHub.
2. In [Render](https://render.com), sign in with GitHub, choose **New > Blueprint**, pick the
   repo, and apply. The first build takes a few minutes.
3. Open `https://<service-name>.onrender.com`. Custom domains go in the `domains` list in
   `render.yaml` (this one serves [jeepy.party](https://jeepy.party)), with DNS records pointing
   at Render.

On the free plan the service sleeps after 15 minutes with nobody connected, and the first visit
afterwards takes about a minute to wake it, so open the link a little before game night. Render
can also restart free services at any time, which ends games in progress.

Vercel and other serverless hosts don't fit: players must all reach the same long-running process.

### Screen wake lock

Phones ask to keep the screen on while in a room. Browsers only allow that on HTTPS (or
localhost), so on plain `http://192.168.x.x` it quietly does nothing. Put the deployed app behind
HTTPS, or turn off auto-lock on the phones for game night.

## Socket contract

Everything in the spec's contract is implemented. Two events were added to cover things the spec
asks for but doesn't name:

- `host:setSettings { buzzTimeoutMs?, finalIncludeAll? }`: the buzz timeout (default 5s, `null`
  turns it off) and whether everyone plays Final Jeopardy.
- `host:endGame`: end the game at any point.
