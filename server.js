require("dotenv").config();

const express = require("express");
const Database = require("better-sqlite3");
const session = require("express-session");
const SqliteStore = require("better-sqlite3-session-store")(session);
const path = require("path");

/**
 * Petri Collider web server.
 * Loads local configuration, renders the game shell, and stores round telemetry.
 */
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = process.env.APP_NAME || "Petri Collider";
const DB_FILE = process.env.DB_FILE || "petricollider.db";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
app.locals.appName = APP_NAME;
app.set("trust proxy", TRUST_PROXY);

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

  CREATE TABLE IF NOT EXISTS round_request_metadata (
    metadata_id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER UNIQUE NOT NULL,
    ip_address TEXT,
    forwarded_for TEXT,
    user_agent TEXT,
    accept_language TEXT,
    referrer TEXT,
    protocol TEXT,
    hostname TEXT,
    browser_timezone TEXT,
    browser_language TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    device_pixel_ratio REAL,
    platform TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (round_id) REFERENCES game_rounds(round_id)
  );

  CREATE INDEX IF NOT EXISTS idx_game_rounds_total_collisions
    ON game_rounds(total_collisions DESC);
  CREATE INDEX IF NOT EXISTS idx_game_rounds_created_at
    ON game_rounds(created_at DESC);
`);

app.use(
  session({
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: SESSION_SECRET || "development-only-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

/** Require an authenticated admin session. */
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect("/admin/login");
}

/** Compare credentials without revealing whether the username or password matched. */
function credentialsMatch(username, password) {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD && ADMIN_USERNAME && ADMIN_PASSWORD;
}

/** Normalize IPv4-mapped IPv6 addresses and loopback aliases. */
function normalizeIpAddress(ipAddress) {
  if (!ipAddress) return null;
  const trimmed = String(ipAddress).trim().replace(/^"|"$/g, "");
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;
  if (trimmed === "::1") return "127.0.0.1";
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

/** Drop a trailing port from an IPv4 or bracketed IPv6 address. */
function stripAddressPort(ipAddress) {
  if (!ipAddress) return null;
  if (ipAddress.startsWith("[")) {
    const end = ipAddress.indexOf("]");
    return end > 0 ? ipAddress.slice(1, end) : ipAddress;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ipAddress)) return ipAddress.split(":")[0];
  return ipAddress;
}

/** True when the peer is a typical reverse-proxy hop on this host or LAN. */
function isLocalProxyPeer(ipAddress) {
  const ip = normalizeIpAddress(ipAddress);
  if (!ip) return false;
  if (ip === "127.0.0.1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return false;
}

/** True when the value is a routable public IPv4 or IPv6 address. */
function isPublicIpAddress(ipAddress) {
  const ip = normalizeIpAddress(stripAddressPort(ipAddress));
  if (!ip || isLocalProxyPeer(ip)) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return ip.split(".").every((octet) => {
      const value = Number(octet);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(":") && ip.split(":").length >= 3;
}

/** Take the left-most IP from a comma-separated forwarding header. */
function firstForwardedIp(headerValue) {
  if (!headerValue) return null;
  return normalizeIpAddress(stripAddressPort(String(headerValue).split(",")[0]));
}

/** Read the client address from an RFC 7239 Forwarded header. */
function ipFromForwardedHeader(headerValue) {
  if (!headerValue) return null;
  const match = String(headerValue).match(/for=\s*"?\[?([^\]";,\s]+)/i);
  return match ? normalizeIpAddress(stripAddressPort(match[1])) : null;
}

/**
 * Prefer CDN/proxy client headers over the TCP peer when the request
 * arrived through a trusted reverse proxy (configured or on a private hop).
 */
function resolveClientIp(req) {
  const peer = normalizeIpAddress(req.socket?.remoteAddress);
  const candidates = [
    firstForwardedIp(req.get("cf-connecting-ip")),
    firstForwardedIp(req.get("true-client-ip")),
    firstForwardedIp(req.get("x-real-ip")),
    firstForwardedIp(req.get("x-client-ip")),
    firstForwardedIp(req.get("x-forwarded-for")),
    ipFromForwardedHeader(req.get("forwarded")),
  ].filter(Boolean);

  const trustHeaders = TRUST_PROXY || isLocalProxyPeer(peer);
  if (trustHeaders && candidates.length) {
    return candidates.find((ip) => !isLocalProxyPeer(ip)) || candidates[0];
  }

  return peer;
}

/**
 * Use proxy headers when they carry a public client, otherwise accept a
 * browser-reported public IP. The TCP peer of a local reverse proxy is never
 * a visitor address.
 */
function resolveStoredClientIp(req, reportedIp) {
  const resolved = resolveClientIp(req);
  const forwardedFor = resolveForwardedFor(req);
  if (resolved && !isLocalProxyPeer(resolved)) {
    return { ipAddress: resolved, forwardedFor };
  }
  if (isPublicIpAddress(reportedIp)) {
    return {
      ipAddress: normalizeIpAddress(stripAddressPort(reportedIp)),
      forwardedFor: forwardedFor || "client-reported",
    };
  }
  return { ipAddress: resolved, forwardedFor };
}

/** Preserve the raw forwarding header chain for the admin console. */
function resolveForwardedFor(req) {
  return (
    req.get("x-forwarded-for") ||
    req.get("forwarded") ||
    req.get("x-real-ip") ||
    req.get("cf-connecting-ip") ||
    req.get("true-client-ip") ||
    req.get("x-client-ip") ||
    null
  );
}

/** Prefer the original client scheme when a trusted proxy terminated TLS. */
function resolveProtocol(req) {
  const peer = normalizeIpAddress(req.socket?.remoteAddress);
  if (TRUST_PROXY || isLocalProxyPeer(peer)) {
    const proto = req.get("x-forwarded-proto") || req.get("x-forwarded-protocol");
    if (proto) return proto.split(",")[0].trim().toLowerCase();
    const forwarded = req.get("forwarded");
    const match = forwarded && forwarded.match(/proto=([^;\s]+)/i);
    if (match) return match[1].toLowerCase();
    const referrer = req.get("referer");
    if (referrer && /^https:/i.test(referrer)) return "https";
  }
  return req.protocol || null;
}

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
    const {
      nickname,
      email,
      totalCollisions,
      runningTimeMs,
      timeToFirstCollisionMs,
      initialBalls,
      windSpeedKmh,
      windAngleRad,
      maxActiveBalls,
      totalBallsCreated,
      totalEvaporated,
      avgSpeedPxf,
      browserTimezone,
      browserLanguage,
      screenWidth,
      screenHeight,
      devicePixelRatio,
      platform,
      reportedIp,
    } = req.body;

    const cleanNick = (nickname || "ANON").trim().toUpperCase();
    const cleanEmail = email ? email.trim() : null;
    const client = resolveStoredClientIp(req, reportedIp);

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
      const round = db
        .prepare(
          `
        INSERT INTO game_rounds (
          player_id, total_collisions, running_time_ms, time_to_first_collision_ms,
          initial_balls, wind_speed_kmh, wind_angle_rad, max_active_balls,
          total_balls_created, total_evaporated, avg_speed_pxf
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
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

      db.prepare(
        `
        INSERT INTO round_request_metadata (
          round_id, ip_address, forwarded_for, user_agent, accept_language,
          referrer, protocol, hostname, browser_timezone, browser_language,
          screen_width, screen_height, device_pixel_ratio, platform
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        round.lastInsertRowid,
        client.ipAddress,
        client.forwardedFor,
        req.get("user-agent") || null,
        req.get("accept-language") || null,
        req.get("referer") || null,
        resolveProtocol(req),
        req.hostname || null,
        browserTimezone || null,
        browserLanguage || null,
        Number.isFinite(Number(screenWidth)) ? Number(screenWidth) : null,
        Number.isFinite(Number(screenHeight)) ? Number(screenHeight) : null,
        Number.isFinite(Number(devicePixelRatio)) ? Number(devicePixelRatio) : null,
        platform || null,
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

/**
 * Return ranked game rounds for the public leaderboard modal.
 * @param {import('express').Request} req Query: type=top|recent, limit=1-100.
 * @param {import('express').Response} res Express response.
 */
app.get("/api/leaderboard", (req, res) => {
  try {
    const type = req.query.type === "recent" ? "recent" : "top";
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 10;

    const orderBy =
      type === "recent"
        ? "g.created_at DESC, g.round_id DESC"
        : "g.total_collisions DESC, g.created_at ASC, g.round_id ASC";

    const rows = db
      .prepare(
        `
      SELECT
        p.nickname,
        g.total_collisions,
        g.running_time_ms,
        g.initial_balls,
        g.created_at
      FROM game_rounds g
      JOIN players p ON g.player_id = p.player_id
      ORDER BY ${orderBy}
      LIMIT ?
    `,
      )
      .all(limit);

    const entries = rows.map((row, index) => ({
      rank: index + 1,
      nickname: row.nickname,
      total_collisions: row.total_collisions,
      running_time_ms: row.running_time_ms,
      initial_balls: row.initial_balls,
      created_at: row.created_at,
    }));

    res.json({ success: true, type, limit, entries });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

/** Render the admin login form. */
app.get("/admin/login", (req, res) => {
  if (req.session.isAdmin) return res.redirect("/admin");
  res.render("admin-login", { error: null, configured: Boolean(ADMIN_USERNAME && ADMIN_PASSWORD && SESSION_SECRET) });
});

/** Authenticate the configured admin account and create a session. */
app.post("/admin/login", (req, res) => {
  const { username = "", password = "" } = req.body;

  if (!credentialsMatch(username.trim(), password)) {
    return res.status(401).render("admin-login", {
      error: "Invalid admin credentials.",
      configured: Boolean(ADMIN_USERNAME && ADMIN_PASSWORD && SESSION_SECRET),
    });
  }

  req.session.isAdmin = true;
  req.session.adminUsername = ADMIN_USERNAME;
  req.session.save(() => res.redirect("/admin"));
});

/** Render a paginated, expandable view of rounds and their related records. */
app.get("/admin", requireAdmin, (req, res) => {
  const pageSize = 20;
  const requestedPage = Number.parseInt(req.query.page, 10) || 1;
  const totalRounds = db.prepare("SELECT COUNT(*) AS count FROM game_rounds").get().count;
  const totalPages = Math.max(1, Math.ceil(totalRounds / pageSize));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const offset = (page - 1) * pageSize;

  const rounds = db
    .prepare(
      `
      SELECT
        g.round_id AS roundId,
        g.created_at AS createdAt,
        g.total_collisions AS totalCollisions,
        g.running_time_ms AS runningTimeMs,
        g.time_to_first_collision_ms AS timeToFirstCollisionMs,
        g.initial_balls AS initialBalls,
        g.wind_speed_kmh AS windSpeedKmh,
        g.wind_angle_rad AS windAngleRad,
        g.max_active_balls AS maxActiveBalls,
        g.total_balls_created AS totalBallsCreated,
        g.total_evaporated AS totalEvaporated,
        g.avg_speed_pxf AS avgSpeedPxf,
        p.player_id AS playerId,
        p.nickname,
        p.email,
        p.created_at AS playerCreatedAt,
        m.ip_address AS ipAddress,
        m.forwarded_for AS forwardedFor,
        m.user_agent AS userAgent,
        m.accept_language AS acceptLanguage,
        m.referrer,
        m.protocol,
        m.hostname,
        m.browser_timezone AS browserTimezone,
        m.browser_language AS browserLanguage,
        m.screen_width AS screenWidth,
        m.screen_height AS screenHeight,
        m.device_pixel_ratio AS devicePixelRatio,
        m.platform
      FROM game_rounds g
      LEFT JOIN players p ON p.player_id = g.player_id
      LEFT JOIN round_request_metadata m ON m.round_id = g.round_id
      ORDER BY g.created_at DESC, g.round_id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(pageSize, offset);

  const viewerIp = resolveClientIp(req);
  const viewerForwarded = resolveForwardedFor(req);

  res.render("admin", {
    appName: APP_NAME,
    adminUsername: req.session.adminUsername,
    rounds,
    page,
    pageSize,
    totalRounds,
    totalPages,
    viewerIp,
    viewerForwarded,
    viewerIpIsProxy: isLocalProxyPeer(viewerIp) && !viewerForwarded,
  });
});

/** Destroy the admin session and return to the login form. */
app.post("/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} running at http://localhost:${PORT}`);
});
