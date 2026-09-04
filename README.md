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

- Node.js 18 or newer
- npm

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

| Variable   | Default            | Description                                                  |
| ---------- | ------------------ | ------------------------------------------------------------ |
| `PORT`     | `3000`             | HTTP port used by Express                                    |
| `APP_NAME` | `Petri Collider`   | Name printed in the server startup message                   |
| `DB_FILE`  | `petricollider.db` | SQLite filename or path, resolved from the project directory |

The repository's example configuration uses port `3800`:

```env
PORT=3800
APP_NAME=PetriCollider
DB_FILE=petricollider.db
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

SQLite is initialized automatically on startup with `players` and `game_rounds` tables. WAL mode is enabled for local database performance. The database, WAL files, `.env`, dependencies, logs, and generated output are excluded by `.gitignore`.

The browser stores the current profile, personal high score, and the last 100 personal scores in `localStorage`. Clearing site data removes those local values but does not remove server-side telemetry.

## Project Origin

This project was created with assistance from Gemini. The implementation and documentation in this repository describe the current codebase and should be treated as the source of truth.

## License

MIT

## Author

Kizito Mrema
