require("dotenv").config();

const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

/**
 * Petri Collider web server.
 * Loads local configuration, renders the game shell, and stores round telemetry.
 */
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = process.env.APP_NAME || "Petri Collider";
const DB_FILE = process.env.DB_FILE || "petricollider.db";
app.locals.appName = APP_NAME;

// Express Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Set EJS as Templating Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Initialize SQLite Database
const db = new Database(path.resolve(__dirname, DB_FILE));
db.pragma("journal_mode = WAL");

// Database Schema Setup
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    player_id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL,
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS game_rounds (
    round_id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    total_collisions INTEGER NOT NULL,
    running_time_ms INTEGER NOT NULL,
    time_to_first_collision_ms INTEGER,
    initial_balls INTEGER NOT NULL,
    wind_speed_kmh REAL NOT NULL,
    wind_angle_rad REAL NOT NULL,
    max_active_balls INTEGER NOT NULL,
    total_balls_created INTEGER NOT NULL,
    total_evaporated INTEGER NOT NULL,
    avg_speed_pxf REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(player_id)
  );
`);

/**
 * Render the game page with the current global high score.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 */
app.get("/", (req, res) => {
  try {
    // Fetch global high score directly from SQLite before rendering
    const globalHigh = db
      .prepare(
        `
      SELECT p.nickname, g.total_collisions AS highScore
      FROM game_rounds g
      JOIN players p ON g.player_id = p.player_id
      ORDER BY g.total_collisions DESC
      LIMIT 1
    `,
      )
      .get() || { nickname: "ANON", highScore: 0 };

    // Render index.ejs and pass initial server data to HTML
    res.render("index", {
      globalHighScore: globalHigh.highScore,
      globalHighScorePlayer: globalHigh.nickname,
    });
  } catch (err) {
    console.error("Render error:", err);
    res.render("index", { globalHighScore: 0, globalHighScorePlayer: "ANON" });
  }
});

/**
 * Store one completed game round and return the current global high score.
 * @param {import('express').Request} req Request containing round telemetry in the JSON body.
 * @param {import('express').Response} res Express response.
 */
app.post("/api/rounds", (req, res) => {
  try {
    const { nickname, email, totalCollisions, runningTimeMs, timeToFirstCollisionMs, initialBalls, windSpeedKmh, windAngleRad, maxActiveBalls, totalBallsCreated, totalEvaporated, avgSpeedPxf } =
      req.body;

    const cleanNick = (nickname || "ANON").trim().toUpperCase();
    const cleanEmail = email ? email.trim() : null;

    const logRoundTx = db.transaction(() => {
      // Insert/update player
      db.prepare(
        `
        INSERT INTO players (nickname, email) VALUES (?, ?)
        ON CONFLICT(nickname) DO UPDATE SET email = COALESCE(EXCLUDED.email, players.email)
      `,
      ).run(cleanNick, cleanEmail);

      const player = db.prepare(`SELECT player_id FROM players WHERE nickname = ?`).get(cleanNick);

      // Log game round
      db.prepare(
        `
        INSERT INTO game_rounds (
          player_id, total_collisions, running_time_ms, time_to_first_collision_ms,
          initial_balls, wind_speed_kmh, wind_angle_rad, max_active_balls,
          total_balls_created, total_evaporated, avg_speed_pxf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        player.player_id,
        totalCollisions || 0,
        runningTimeMs || 0,
        timeToFirstCollisionMs || 0,
        initialBalls || 2,
        windSpeedKmh || 0,
        windAngleRad || 0,
        maxActiveBalls || 0,
        totalBallsCreated || 0,
        totalEvaporated || 0,
        avgSpeedPxf || 0,
      );
    });

    logRoundTx();

    // Return latest global record after update
    const newGlobal = db
      .prepare(
        `
      SELECT p.nickname, g.total_collisions AS highScore
      FROM game_rounds g
      JOIN players p ON g.player_id = p.player_id
      ORDER BY g.total_collisions DESC
      LIMIT 1
    `,
      )
      .get();

    res.json({ success: true, globalHigh: newGlobal });
  } catch (err) {
    console.error("Error logging round:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} running at http://localhost:${PORT}`);
});
