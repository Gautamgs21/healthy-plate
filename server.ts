import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";

const DATA_FILE = path.resolve(process.cwd(), ".local-hp-data.json");

interface UserRecord {
  id: string;
  username: string;
  name: string;
  passwordHash: string;
}

interface SyncItem {
  key: string;
  value: unknown;
  updatedAt: number;
}

interface DbStore {
  users: Record<string, UserRecord>;
  data: Record<string, Record<string, SyncItem>>;
}

function loadDb(): DbStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as DbStore;
    }
  } catch {
    // ignore corrupt local file
  }
  return { users: {}, data: {} };
}

function saveDb(db: DbStore) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch {
    // ignore write errors
  }
}

const SECRET = process.env.AUTH_SECRET || "healthy-plate-dev-secret-change-in-prod";

function signToken(payload: { id: string; username: string; name: string }) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { id: string; username: string; name: string };
  } catch {
    return null;
  }
}

function hashPass(password: string) {
  const salt = crypto.randomBytes(8).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function checkPass(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(derived, "hex"));
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true, mode: "local-dev", mongoUriSet: false, authSecretSet: true, dbConnected: true });
  });

  app.post("/api/auth", (req, res) => {
    const { action, username, password, name, invite } = req.body || {};
    const uname = String(username || "").trim().toLowerCase();
    const pass = String(password || "");
    if (!uname || !pass) {
      res.status(400).json({ error: "Username and password are required." });
      return;
    }

    const db = loadDb();
    if (action === "register") {
      if (process.env.ALLOW_REGISTRATION === "false") {
        res.status(403).json({ error: "Registration is closed." });
        return;
      }
      if (process.env.REGISTRATION_CODE && invite !== process.env.REGISTRATION_CODE) {
        res.status(403).json({ error: "Invite code is missing or wrong." });
        return;
      }
      if (pass.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters." });
        return;
      }
      if (db.users[uname]) {
        res.status(409).json({ error: "That username is already taken." });
        return;
      }
      const user: UserRecord = {
        id: "u_" + crypto.randomUUID(),
        username: uname,
        name: String(name || uname).trim(),
        passwordHash: hashPass(pass),
      };
      db.users[uname] = user;
      saveDb(db);
      const token = signToken({ id: user.id, username: user.username, name: user.name });
      res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
      return;
    }

    const user = db.users[uname];
    if (!user || !checkPass(pass, user.passwordHash)) {
      res.status(401).json({ error: "Wrong username or password." });
      return;
    }
    const token = signToken({ id: user.id, username: user.username, name: user.name });
    res.json({ token, user: { id: user.id, username: user.username, name: user.name } });
  });

  app.get("/api/sync", (req, res) => {
    const auth = req.headers.authorization || "";
    const user = verifyToken(auth.replace(/^Bearer\s+/i, ""));
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const db = loadDb();
    const userBucket = db.data[user.id] || {};
    res.json({ items: Object.values(userBucket) });
  });

  app.post("/api/sync", (req, res) => {
    const auth = req.headers.authorization || "";
    const user = verifyToken(auth.replace(/^Bearer\s+/i, ""));
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const db = loadDb();
    db.data[user.id] = db.data[user.id] || {};
    for (const it of items) {
      if (!it || typeof it.key !== "string" || !/^[A-Za-z0-9_-]{1,60}$/.test(it.key)) continue;
      db.data[user.id][it.key] = {
        key: it.key,
        value: it.value,
        updatedAt: Number(it.t) || Date.now(),
      };
    }
    saveDb(db);
    res.json({ ok: true });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(3000, "0.0.0.0", () => {
    console.log("Healthy Plate server running on http://0.0.0.0:3000");
  });
}

startServer();
