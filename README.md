# Petri Collider

Petri Collider is a retro dot-matrix browser game built with Node.js and Express. Drag the launcher and release it to send balls into a circular petri dish. Balls bounce, collide, reproduce, age, and evaporate; each round is scored by the number of ball-to-ball collisions.

## Features

- Drag-and-release slingshot controls with touch and mouse support
- Circular 2D physics with wall bounces, collision response, wind, reproduction, and evaporation
- Personal score history stored in the browser
- Global high score and round telemetry stored in SQLite
- Server-rendered initial scores using EJS
- Responsive single-page interface with custom dot-matrix fonts

## Requirements

- Node.js `26.8.1`
- npm 11 or newer

The required Node version is pinned in `.nvmrc`. With nvm installed, use:

```bash
nvm install
nvm use
```

## Setup

```bash
npm install
cp example.env .env
node server.js
```

Open `http://localhost:3800` in a browser. The port comes from `.env`; it is not necessary to edit the server source.

For development with automatic restarts:

```bash
npx nodemon
```

There are currently no automated tests configured. Check server syntax with:

```bash
node --check server.js
```

## Configuration

Create `.env` in the project root. `.env` is ignored by Git; use `example.env` as the shareable template.

| Variable         | Default            | Description                                                       |
| ---------------- | ------------------ | ----------------------------------------------------------------- |
| `PORT`           | `3000`             | HTTP port used by Express                                         |
| `APP_NAME`       | `Petri Collider`   | Name printed in the server startup message                        |
| `DB_FILE`        | `petricollider.db` | SQLite filename or path, resolved from the project directory      |
| `TRUST_PROXY`    | `false`            | Trust client-IP headers from any hop. Local reverse proxies are auto-trusted |
| `ADMIN_USERNAME` | unset              | Username allowed to access the admin console                      |
| `ADMIN_PASSWORD` | unset              | Password allowed to access the admin console                      |
| `SESSION_SECRET` | unset              | Secret used to sign admin session cookies                         |

The repository's example configuration uses port `3800`:

```env
PORT=3800
APP_NAME=PetriCollider
DB_FILE=petricollider.db
TRUST_PROXY=false
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
SESSION_SECRET=replace-with-a-long-random-secret
```

## Project Structure

```text
server.js             Express app, routes, database setup, and configuration
views/index.ejs       Server-rendered page and browser game engine
public/fonts/         Static dot-matrix font files served by Express
example.env           Shareable environment template
petricollider.db      Local SQLite database created at runtime (ignored)
```

Express serves `public/` at the site root, so files in `public/fonts/` are available at `/fonts/...`. EJS templates are kept in `views/` and are rendered by the `/` route.

## HTTP API

### `GET /`

Renders the game page and injects the current global high score and player name into the EJS template. If no score exists, the page displays `0` and `ANON`.

### `POST /api/rounds`

Stores one completed round. The request body is JSON:

```json
{
  "nickname": "PLAYER1",
  "email": "user@example.com",
  "totalCollisions": 12,
  "runningTimeMs": 15400,
  "timeToFirstCollisionMs": 3200,
  "initialBalls": 3,
  "windSpeedKmh": 7.4,
  "windAngleRad": 1.2,
  "maxActiveBalls": 48,
  "totalBallsCreated": 80,
  "totalEvaporated": 32,
  "avgSpeedPxf": 4.6
}
```

## Admin Console

Open `/admin/login` and sign in with `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`. Successful authentication creates an HTTP-only, same-site session cookie backed by SQLite. Sessions expire after eight hours, and `/admin/logout` ends the session.

The protected `/admin` view shows 20 rounds per page. Each row summarizes the round, player, score, and runtime; expand a row to inspect all physics, player, network, and device metadata fields. The console is intentionally read-only.

Set a long random `SESSION_SECRET` in production and replace the example admin password before exposing the app. IP addresses, user agents, device characteristics, and browser context are personal data; restrict admin access and retain only what the project needs.

The response includes the current global high score:

```json
{
  "success": true,
  "globalHigh": {
    "nickname": "PLAYER1",
    "highScore": 12
  }
}
```

## Data and Browser Storage

SQLite is initialized automatically on startup with `players`, `game_rounds`, and `round_request_metadata` tables. WAL mode is enabled for local database performance. Each submitted round stores request metadata such as IP address, user agent, language, referrer, protocol, hostname, and browser context. Geographic location is not collected because IP geolocation requires a separate provider and privacy policy decision. When the TCP peer is localhost or a private hop, the server also reads `X-Real-IP`, `X-Forwarded-For`, and `CF-Connecting-IP` so a same-host reverse proxy does not get stored as `127.0.0.1`. Set `TRUST_PROXY=true` if a public proxy hop should be trusted as well.

The browser stores the current profile, personal high score, and the last 100 personal scores in `localStorage`. Clearing site data removes those local values but does not remove server-side telemetry.

## Project Origin

This project was created with assistance from Gemini. The implementation and documentation in this repository describe the current codebase and should be treated as the source of truth.

## License

MIT

## Author

Kizito Mrema
