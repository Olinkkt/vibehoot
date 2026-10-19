# Slophoot

Self-hosted Kahoot-style quiz. The GitHub repository is [Olinkkt/vibehoot](https://github.com/Olinkkt/vibehoot); the app name is Slophoot. This milestone is the lobby: a host creates a room, players join with a PIN and nickname, and the host sees the list update live. Starting the game is not implemented yet. Room state lives in memory and is cleared when the server restarts.

## Run in development

```bash
npm install
npm run dev
```

`npm run dev` runs `tsx watch server.ts`, which serves Next.js and Socket.io on the same HTTP server.

- Host: [http://localhost:3000/host](http://localhost:3000/host)
- Players: [http://localhost:3000](http://localhost:3000)

Reloading the host page asks for confirmation. If the host reloads anyway, or the connection drops, the room stays open for 12 seconds. The host page keeps a host token in `sessionStorage` and, on reconnect, reclaims the same PIN and player list. Players see "The room was closed" only if the host does not come back in that time.

## Production

```bash
npm run build
npm start
```

## Folder structure

- `server.ts` — HTTP server, Next.js request handler, and Socket.io
- `src/server/rooms.ts` — in-memory rooms, PIN generation, and join rules
- `src/server/socket.ts` — host, player, and disconnect events
- `src/shared/events.ts` — shared Socket.io event types
- `src/lib/socket.ts` — typed Socket.io client hook
- `src/app/page.tsx` — player join page
- `src/app/host/page.tsx` — host lobby

Room rules are covered by `npm test`. `npm run lint` checks the source, and `npm run typecheck` generates Next.js route types and then runs `tsc --noEmit`.

## Configuration

`PORT` (default `3000`) is the HTTP port.

`HOST` sets the bind address. Leave it unset to listen on every interface, which is what you want when players join from phones on the same network. The startup log then lists those LAN addresses next to `http://localhost:<port>`. Set `HOST=127.0.0.1` to accept connections from this machine only.

`HOST_CREATE_COOLDOWN_MS` (default `1000`) is the minimum time between room creates on one connection. `HOST_CREATE_MAX_PER_IP` (default `20`) is how many rooms one client address can have open. The cap uses the socket's remote address. When every PIN is already taken, the host gets an error instead of staying on "Creating room…".

`ALLOWED_ORIGINS` is an optional comma-separated list of extra browser origins allowed to open a Socket.io connection, for example `https://quiz.example.com`. A connection is allowed when its `Origin` host matches the request `Host`, when that origin is in the list, or when the request has no `Origin` header (non-browser clients). Other origins are refused.

`ALLOWED_HOSTS` is an optional comma-separated list of hostnames or IP addresses this server should answer for. A port is optional (`localhost`, `127.0.0.1`, `192.168.1.20:3000`, `[::1]`). When the variable is set, HTTP requests and Socket.io connections whose `Host` header is not in the list are rejected. An entry without a port matches that host on any port; an entry with a port must match exactly. When `ALLOWED_HOSTS` is unset, every `Host` value is accepted and the origin check is unchanged. Set it when the process is reachable from a network you do not fully trust, so a DNS-rebinding client cannot pass the origin check by sending a matching `Host` and `Origin`.

## Dependency audit

`npm audit` reports [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) on upstream `braces` (a transitive ESLint dependency, dev-only). It only expands glob patterns from this repo's own ESLint config, so the advisory is accepted. Do not run `npm audit fix --force` to clear it: that downgrades `eslint-config-next`.
