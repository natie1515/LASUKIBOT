// webserver.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const {
  getConfig,
  setConfig,
  deleteConfig,
  getAllConfigs
} = require("./db");

// 🌐 URL CENTRAL DE LA PÁGINA WEB GENERAL DE LA SUKI BOT
const SUKI_PANEL_URL = "https://la-suki-bot.ultraplus.click";
const SUKI_REGISTER_URL = `${SUKI_PANEL_URL}/api/register-bot`;

// 🌐 URL pública fija de ESTA Suki.
// Si Pterodactyl cambia el puerto, cambia solo esta línea.
const SUKI_PUBLIC_URL_FALLBACK = "http://64.20.54.50:30037";

const API_KEYS_PATH = path.resolve("./api_keys.json");
const WEB_SETTINGS_PATH = path.resolve("./web_settings.json");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024
  }
});

const CONFIG_KEYS = new Set([
  "welcome",
  "despedidas",
  "antilink",
  "linkall",
  "antidelete",
  "modoadmins",
  "antiarabe",
  "antiarabe2",
  "antis",
  "chatgpt",
  "apagado"
]);

function readKeys() {
  try {
    if (!fs.existsSync(API_KEYS_PATH)) {
      fs.writeFileSync(API_KEYS_PATH, JSON.stringify([], null, 2));
      return [];
    }

    const data = JSON.parse(fs.readFileSync(API_KEYS_PATH, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function readWebSettings() {
  try {
    if (!fs.existsSync(WEB_SETTINGS_PATH)) {
      fs.writeFileSync(WEB_SETTINGS_PATH, JSON.stringify({}, null, 2));
      return {};
    }

    const data = JSON.parse(fs.readFileSync(WEB_SETTINGS_PATH, "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveWebSettings(data) {
  try {
    fs.writeFileSync(WEB_SETTINGS_PATH, JSON.stringify(data || {}, null, 2));
  } catch {}
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function verifyApiKey(rawKey) {
  if (!rawKey) return false;

  const hash = sha256(rawKey);
  const keys = readKeys();

  return keys.some(k => k.hash === hash && k.active !== false);
}

function getBearer(req) {
  const auth = String(req.headers.authorization || "");

  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  return (
    req.headers["x-api-key"] ||
    req.query.apikey ||
    ""
  );
}

function authMiddleware(req, res, next) {
  const key = getBearer(req);

  if (!verifyApiKey(key)) {
    return res.status(401).json({
      ok: false,
      error: "API key inválida"
    });
  }

  next();
}

function getSock() {
  return global.sukiSock || global.sock || null;
}

function parseChatIds(value) {
  if (!value) return [];

  if (Array.isArray(value)) return value.filter(Boolean);

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}

    return value
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeConfigValue(value) {
  const v = String(value).toLowerCase();

  return (
    value === true ||
    value === 1 ||
    v === "1" ||
    v === "on" ||
    v === "true" ||
    v === "activar" ||
    v === "activado"
  );
}

function updatePublicBaseUrl(req) {
  try {
    const protocol =
      req.headers["x-forwarded-proto"] ||
      req.protocol ||
      "http";

    const host =
      req.headers["x-forwarded-host"] ||
      req.get("host");

    if (!host) return;

    const currentUrl = normalizeUrl(`${protocol}://${host}`);
    const settings = readWebSettings();

    if (settings.public_base_url !== currentUrl) {
      settings.public_base_url = currentUrl;
      settings.updatedAt = Date.now();

      saveWebSettings(settings);

      global.SUKI_PUBLIC_BASE_URL = currentUrl;

      console.log(`🌍 URL pública de esta Suki actualizada: ${currentUrl}`);

      if (typeof global.registerSukiWithPanel === "function") {
        setTimeout(() => {
          global.registerSukiWithPanel("url-updated").catch(() => {});
        }, 1000);
      }
    }
  } catch (e) {
    console.error("❌ Error actualizando URL pública:", e.message);
  }
}

function getPublicBaseUrl() {
  const settings = readWebSettings();

  return normalizeUrl(
    global.SUKI_PUBLIC_BASE_URL ||
    settings.public_base_url ||
    SUKI_PUBLIC_URL_FALLBACK ||
    ""
  );
}

async function registerSukiWithPanel(reason = "manual") {
  try {
    const publicUrl = getPublicBaseUrl();

    if (!publicUrl) {
      console.log("⚠️ No se registró Suki: falta publicUrl.");
      return false;
    }

    const keys = readKeys()
      .filter(k => k && k.hash && k.active !== false)
      .map(k => ({
        id: k.id || "",
        hash: k.hash,
        active: k.active !== false,
        createdAt: k.createdAt || null,
        createdBy: k.createdBy || null
      }));

    if (!keys.length) {
      console.log("⚠️ No se registró Suki: no hay API keys activas.");
      return false;
    }

    const body = {
      botName: "La Suki Bot",
      publicUrl,
      reason,
      registeredAt: Date.now(),
      keys
    };

    const res = await axios.post(SUKI_REGISTER_URL, body, {
      headers: {
        "Content-Type": "application/json"
      },
      timeout: 20000,
      validateStatus: () => true
    });

    if (!res.data || res.data.ok !== true) {
      console.log("⚠️ No se pudo registrar Suki en el panel central:", res.status, res.data);
      return false;
    }

    console.log(`✅ Suki registrada en el panel central: ${SUKI_PANEL_URL}`);
    console.log(`✅ Keys registradas: ${res.data.saved}`);
    console.log(`✅ URL pública enviada: ${publicUrl}`);

    return true;
  } catch (e) {
    console.log("⚠️ Registro con panel central pendiente:", e.message);
    return false;
  }
}

async function getGroups(sock) {
  const groups = await sock.groupFetchAllParticipating();

  return Object.entries(groups).map(([id, g]) => {
    const config = getAllConfigs(id);

    return {
      id,
      subject: g.subject || "Sin nombre",
      owner: g.owner || null,
      announce: !!g.announce,
      restrict: !!g.restrict,
      participants: Array.isArray(g.participants) ? g.participants.length : 0,
      config
    };
  });
}

function makeJsonBodyLimit(app) {
  app.use(express.json({ limit: "30mb" }));
  app.use(express.urlencoded({ extended: true, limit: "30mb" }));
}

function startWebServer(sock) {
  global.sukiSock = sock;
  global.sock = sock;
  global.registerSukiWithPanel = registerSukiWithPanel;

  if (global.__SUKI_WEB_SERVER_STARTED) {
    console.log("🌐 API web de Suki ya estaba iniciada, sock actualizado.");

    setTimeout(() => {
      registerSukiWithPanel("sock-updated").catch(() => {});
    }, 1000);

    return;
  }

  global.__SUKI_WEB_SERVER_STARTED = true;

  const app = express();

  const PORT =
    process.env.SERVER_PORT ||
    process.env.PORT ||
    process.env.SUKI_API_PORT ||
    process.env.P_SERVER_PORT ||
    3001;

  app.set("trust proxy", 1);

  app.use(cors());
  makeJsonBodyLimit(app);

  app.use((req, res, next) => {
    updatePublicBaseUrl(req);
    next();
  });

  app.get("/", (req, res) => {
    res.json({
      ok: true,
      name: "La Suki Bot API",
      status: "online",
      publicUrl: getPublicBaseUrl() || null,
      panelUrl: SUKI_PANEL_URL
    });
  });

  app.get("/api/status", authMiddleware, async (req, res) => {
    const sock = getSock();

    res.json({
      ok: true,
      connected: !!sock?.user,
      user: sock?.user || null,
      publicUrl: getPublicBaseUrl() || null,
      panelUrl: SUKI_PANEL_URL
    });
  });

  app.post("/api/register-now", authMiddleware, async (req, res) => {
    const ok = await registerSukiWithPanel("manual-api");

    res.json({
      ok,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null
    });
  });

  app.get("/api/groups", authMiddleware, async (req, res) => {
    try {
      const sock = getSock();
      if (!sock) throw new Error("Sock no disponible");

      const groups = await getGroups(sock);

      res.json({
        ok: true,
        total: groups.length,
        groups
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.get("/api/groups/:chatId/config", authMiddleware, async (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const config = getAllConfigs(chatId);

      res.json({
        ok: true,
        chatId,
        config
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/groups/:chatId/config", authMiddleware, async (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const { key, value } = req.body || {};

      if (!key || !CONFIG_KEYS.has(key)) {
        return res.status(400).json({
          ok: false,
          error: "Config no permitida"
        });
      }

      const active = normalizeConfigValue(value);

      if (active) {
        setConfig(chatId, key, 1);
      } else {
        deleteConfig(chatId, key);
      }

      res.json({
        ok: true,
        chatId,
        key,
        value: active ? 1 : 0
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/send/text", authMiddleware, async (req, res) => {
    try {
      const sock = getSock();
      if (!sock) throw new Error("Sock no disponible");

      const { text } = req.body || {};
      const chatIds = parseChatIds(req.body.chatIds || req.body.chatId);

      if (!chatIds.length) {
        return res.status(400).json({
          ok: false,
          error: "Falta chatId o chatIds"
        });
      }

      if (!text) {
        return res.status(400).json({
          ok: false,
          error: "Falta text"
        });
      }

      const results = [];

      for (const chatId of chatIds) {
        try {
          await sock.sendMessage(chatId, { text: String(text) });
          results.push({ chatId, ok: true });
        } catch (e) {
          results.push({ chatId, ok: false, error: e.message });
        }
      }

      res.json({
        ok: true,
        results
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/send/media", authMiddleware, upload.single("file"), async (req, res) => {
    try {
      const sock = getSock();
      if (!sock) throw new Error("Sock no disponible");

      const chatIds = parseChatIds(req.body.chatIds || req.body.chatId);
      const caption = String(req.body.caption || "");

      if (!chatIds.length) {
        return res.status(400).json({
          ok: false,
          error: "Falta chatId o chatIds"
        });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          ok: false,
          error: "Falta archivo"
        });
      }

      const mimetype = req.file.mimetype || "";
      const buffer = req.file.buffer;

      let payload;

      if (mimetype.startsWith("image/")) {
        payload = { image: buffer, caption };
      } else if (mimetype.startsWith("video/")) {
        payload = { video: buffer, caption };
      } else if (mimetype.startsWith("audio/")) {
        payload = {
          audio: buffer,
          mimetype,
          ptt: false
        };
      } else {
        payload = {
          document: buffer,
          mimetype: mimetype || "application/octet-stream",
          fileName: req.file.originalname || "archivo.bin",
          caption
        };
      }

      const results = [];

      for (const chatId of chatIds) {
        try {
          await sock.sendMessage(chatId, payload);
          results.push({ chatId, ok: true });
        } catch (e) {
          results.push({ chatId, ok: false, error: e.message });
        }
      }

      res.json({
        ok: true,
        results
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/groups/:chatId/leave", authMiddleware, async (req, res) => {
    try {
      const sock = getSock();
      if (!sock) throw new Error("Sock no disponible");

      const chatId = decodeURIComponent(req.params.chatId);

      await sock.groupLeave(chatId);

      res.json({
        ok: true,
        chatId,
        left: true
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`🌐 API web de La Suki Bot activa en puerto ${PORT}`);
    console.log(`🌐 Panel central configurado: ${SUKI_PANEL_URL}`);
    console.log(`🌐 URL pública fallback de esta Suki: ${SUKI_PUBLIC_URL_FALLBACK}`);

    setTimeout(() => {
      registerSukiWithPanel("startup").catch(() => {});
    }, 3000);
  });
}

module.exports = {
  startWebServer
};
