"use strict";

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

const SUKI_PANEL_URL = "https://la-suki-bot.ultraplus.click";
const API_KEYS_PATH = path.resolve("./api_keys.json");
const WEB_SETTINGS_PATH = path.resolve("./web_settings.json");
const ACTIVOSS_PATH = path.resolve("./activoss.json");

// ✅ CAMBIO: ahora Suki preguntará al panel cada 15 segundos
const RELAY_POLL_INTERVAL_MS = 15000;
const RELAY_REGISTER_INTERVAL_MS = 60000;

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
  "antis",
  "reaccion"
]);

const CONFIG_LABELS = {
  welcome: "🎉 Bienvenidas",
  despedidas: "👋 Despedidas",
  antilink: "🔗 Antilink",
  linkall: "🌐 LinkAll",
  antidelete: "🛡️ Antidelete",
  modoadmins: "👑 Modo admins",
  antiarabe: "🚫 Anti árabe",
  antis: "🎭 Anti stickers",
  reaccion: "⚡ Reacciones automáticas"
};

let relayBusy = false;
let relayStarted = false;
let lastGroupsCache = [];
let lastGroupsAt = 0;
let lastPollErrorLogAt = 0;

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

function readActivoss() {
  try {
    if (!fs.existsSync(ACTIVOSS_PATH)) {
      fs.writeFileSync(ACTIVOSS_PATH, JSON.stringify({}, null, 2));
      return {};
    }

    const data = JSON.parse(fs.readFileSync(ACTIVOSS_PATH, "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveActivoss(data) {
  try {
    fs.writeFileSync(ACTIVOSS_PATH, JSON.stringify(data || {}, null, 2));
  } catch {}
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

function getServerPort() {
  return (
    process.env.SERVER_PORT ||
    process.env.P_SERVER_PORT ||
    process.env.SUKI_API_PORT ||
    process.env.PORT ||
    3001
  );
}

function normalizeUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function getPublicBaseUrl() {
  const settings = readWebSettings();

  return normalizeUrl(
    global.SUKI_PUBLIC_BASE_URL ||
    settings.public_base_url ||
    ""
  );
}

function updatePublicBaseUrl(req) {
  try {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const host = req.get("host");

    if (!host) return;

    const currentUrl = normalizeUrl(`${protocol}://${host}`);
    const settings = readWebSettings();

    if (settings.public_base_url !== currentUrl) {
      settings.public_base_url = currentUrl;
      settings.updatedAt = Date.now();

      saveWebSettings(settings);

      global.SUKI_PUBLIC_BASE_URL = currentUrl;

      console.log(`🌍 URL pública de esta Suki actualizada: ${currentUrl}`);
    }
  } catch (e) {
    console.error("❌ Error actualizando URL pública:", e.message);
  }
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

function getActiveKeyPayload() {
  return readKeys()
    .filter(k => k && k.hash && k.active !== false)
    .map(k => ({
      id: k.id || "",
      hash: String(k.hash).trim().toLowerCase(),
      active: k.active !== false,
      createdAt: k.createdAt || null,
      createdBy: k.createdBy || null
    }));
}

function getReaccionStatus(chatId) {
  const db = readActivoss();
  const estado = String(db?.[chatId]?.reacion || "on").toLowerCase();
  return estado === "off" ? 0 : 1;
}

function setReaccionStatus(chatId, active) {
  const db = readActivoss();

  db[chatId] = db[chatId] || {};
  db[chatId].reacion = active ? "on" : "off";
  db[chatId].updatedAt = Date.now();

  saveActivoss(db);

  return active ? 1 : 0;
}

async function notifyConfig(sock, chatId, key, active) {
  try {
    const label = CONFIG_LABELS[key] || key;
    const estado = active ? "activada ✅" : "desactivada ❌";

    await sock.sendMessage(chatId, {
      text:
`⚙️✨ *Configuración actualizada desde el panel web*

${label} fue *${estado}*.

👑 Acción ejecutada por mi dueño desde el panel de *La Suki Bot*.`
    });
  } catch (e) {
    console.log("⚠️ No se pudo notificar config en grupo:", e.message);
  }
}

async function notifyGroupMode(sock, chatId, mode) {
  try {
    if (mode === "open") {
      await sock.sendMessage(chatId, {
        text:
`🔓✨ *Grupo abierto*

Ahora todos los integrantes pueden enviar mensajes.

👑 Acción ejecutada desde el panel web de *La Suki Bot*.`
      });
    } else {
      await sock.sendMessage(chatId, {
        text:
`🔒✨ *Grupo cerrado*

Ahora solo los administradores pueden enviar mensajes.

👑 Acción ejecutada desde el panel web de *La Suki Bot*.`
      });
    }
  } catch (e) {
    console.log("⚠️ No se pudo notificar modo de grupo:", e.message);
  }
}

async function applyGroupMode(sock, chatId, mode) {
  if (!chatId) throw new Error("Falta chatId");

  if (mode === "open") {
    await sock.groupSettingUpdate(chatId, "not_announcement");
    await notifyGroupMode(sock, chatId, "open");

    return {
      chatId,
      mode: "open",
      announce: false
    };
  }

  if (mode === "close") {
    await notifyGroupMode(sock, chatId, "close");
    await sock.groupSettingUpdate(chatId, "announcement");

    return {
      chatId,
      mode: "close",
      announce: true
    };
  }

  throw new Error("Modo inválido");
}

async function applyConfig(sock, chatId, key, value, notify = true) {
  if (!chatId) throw new Error("Falta chatId");
  if (!CONFIG_KEYS.has(key)) throw new Error("Config no permitida");

  const active = normalizeConfigValue(value);

  if (key === "reaccion") {
    setReaccionStatus(chatId, active);
  } else {
    if (active) {
      setConfig(chatId, key, 1);
    } else {
      deleteConfig(chatId, key);
    }
  }

  if (notify) {
    await notifyConfig(sock, chatId, key, active);
  }

  lastGroupsAt = 0;

  return {
    chatId,
    key,
    value: active ? 1 : 0
  };
}

async function getGroups(sock) {
  const groups = await sock.groupFetchAllParticipating();

  return Object.entries(groups).map(([id, g]) => {
    const config = getAllConfigs(id) || {};

    config.reaccion = getReaccionStatus(id);

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

async function getGroupsCached(sock, force = false) {
  const now = Date.now();

  if (!force && lastGroupsCache.length && now - lastGroupsAt < 15000) {
    return lastGroupsCache;
  }

  lastGroupsCache = await getGroups(sock);
  lastGroupsAt = now;

  return lastGroupsCache;
}

async function makeState(sock) {
  let groups = [];

  try {
    groups = await getGroupsCached(sock, false);
  } catch {}

  return {
    connected: !!sock?.user,
    user: sock?.user || null,
    groups
  };
}

async function registerWithPanel(reason = "manual") {
  try {
    const keys = getActiveKeyPayload();

    if (!keys.length) {
      console.log("⚠️ No se registró Suki: no hay API keys activas.");
      return false;
    }

    const sock = getSock();
    const state = sock ? await makeState(sock) : {};

    const body = {
      botName: "La Suki Bot",
      publicUrl: getPublicBaseUrl(),
      reason,
      registeredAt: Date.now(),
      keys,
      user: state.user || null,
      groups: state.groups || []
    };

    const res = await axios.post(`${SUKI_PANEL_URL}/api/register-bot`, body, {
      timeout: 20000,
      validateStatus: () => true
    });

    if (!res.data || res.data.ok !== true) {
      console.log("⚠️ Registro panel falló:", res.status, res.data);
      return false;
    }

    console.log(`✅ Suki registrada en panel central. Keys: ${res.data.saved}`);
    return true;
  } catch (e) {
    console.log("⚠️ Registro con panel pendiente:", e.message);
    return false;
  }
}

async function reportTaskResult(taskId, ok, result = {}, error = "") {
  try {
    await axios.post(`${SUKI_PANEL_URL}/api/bot/task-result`, {
      taskId,
      ok,
      result,
      error
    }, {
      timeout: 30000,
      validateStatus: () => true
    });
  } catch (e) {
    console.log("⚠️ No se pudo reportar task:", taskId, e.message);
  }
}

async function executeTask(sock, task) {
  const type = task.type;
  const payload = task.payload || {};

  console.log(`📥 Ejecutando task #${task.id}: ${type}`);

  if (type === "get_status") {
    return {
      connected: !!sock?.user,
      user: sock?.user || null
    };
  }

  if (type === "get_groups") {
    const groups = await getGroupsCached(sock, true);

    return { groups };
  }

  if (type === "set_config") {
    const chatId = String(payload.chatId || "");
    const key = String(payload.key || "");
    const value = payload.value;

    const data = await applyConfig(sock, chatId, key, value, true);

    return {
      ...data,
      groups: await getGroupsCached(sock, true)
    };
  }

  if (type === "group_mode") {
    const chatId = String(payload.chatId || "");
    const mode = String(payload.mode || "");

    const data = await applyGroupMode(sock, chatId, mode);

    lastGroupsAt = 0;

    return {
      ...data,
      groups: await getGroupsCached(sock, true).catch(() => [])
    };
  }

  if (type === "send_text") {
    const text = String(payload.text || "");
    const chatIds = parseChatIds(payload.chatIds || payload.chatId);

    if (!text) throw new Error("Falta text");
    if (!chatIds.length) throw new Error("Falta chatIds");

    const results = [];

    for (const chatId of chatIds) {
      try {
        await sock.sendMessage(chatId, { text });
        results.push({ chatId, ok: true });
      } catch (e) {
        results.push({ chatId, ok: false, error: e.message });
      }
    }

    return { results };
  }

  if (type === "send_media") {
    const chatIds = parseChatIds(payload.chatIds || payload.chatId);
    const caption = String(payload.caption || "");
    const mimetype = String(payload.mimetype || "application/octet-stream");
    const fileName = String(payload.fileName || "archivo.bin");
    const fileBase64 = String(payload.fileBase64 || "");

    if (!chatIds.length) throw new Error("Falta chatIds");
    if (!fileBase64) throw new Error("Falta archivo");

    const buffer = Buffer.from(fileBase64, "base64");

    let msgPayload;

    if (mimetype.startsWith("image/")) {
      msgPayload = { image: buffer, caption };
    } else if (mimetype.startsWith("video/")) {
      msgPayload = { video: buffer, caption };
    } else if (mimetype.startsWith("audio/")) {
      msgPayload = {
        audio: buffer,
        mimetype,
        ptt: false
      };
    } else {
      msgPayload = {
        document: buffer,
        mimetype,
        fileName,
        caption
      };
    }

    const results = [];

    for (const chatId of chatIds) {
      try {
        await sock.sendMessage(chatId, msgPayload);
        results.push({ chatId, ok: true });
      } catch (e) {
        results.push({ chatId, ok: false, error: e.message });
      }
    }

    return { results };
  }

  if (type === "leave_group") {
    const chatId = String(payload.chatId || "");

    if (!chatId) throw new Error("Falta chatId");

    try {
      await sock.sendMessage(chatId, {
        text:
`👋💜 *Suki se va del grupo...*

Mi dueño me sacó desde el panel web.

Gracias por usar *La Suki Bot*.  
Bye bye ✨🚀`
      });
    } catch {}

    await new Promise(resolve => setTimeout(resolve, 1200));

    await sock.groupLeave(chatId);

    lastGroupsAt = 0;

    return {
      chatId,
      left: true,
      groups: await getGroupsCached(sock, true).catch(() => [])
    };
  }

  throw new Error(`Task desconocida: ${type}`);
}

function logPollError(message, data) {
  const now = Date.now();

  // ✅ Para no llenar consola: solo muestra error cada 30 segundos
  if (now - lastPollErrorLogAt < 30000) return;

  lastPollErrorLogAt = now;

  if (data) {
    console.log(message, data);
  } else {
    console.log(message);
  }
}

async function relayPollOnce() {
  if (relayBusy) return;

  relayBusy = true;

  try {
    const sock = getSock();
    if (!sock) return;

    const keys = getActiveKeyPayload();

    if (!keys.length) {
      return;
    }

    const state = await makeState(sock);

    const res = await axios.post(`${SUKI_PANEL_URL}/api/bot/poll`, {
      botName: "La Suki Bot",
      publicUrl: getPublicBaseUrl(),
      keys,
      state
    }, {
      timeout: 25000,
      validateStatus: () => true
    });

    if (!res.data || res.data.ok !== true) {
      logPollError(`⚠️ Poll panel falló: ${res.status}`, res.data);
      return;
    }

    const tasks = Array.isArray(res.data.tasks) ? res.data.tasks : [];

    for (const task of tasks) {
      try {
        const result = await executeTask(sock, task);
        await reportTaskResult(task.id, true, result, "");
      } catch (e) {
        console.log(`❌ Task #${task.id} error:`, e.message);
        await reportTaskResult(task.id, false, {}, e.message);
      }
    }
  } catch (e) {
    logPollError("⚠️ Relay polling pendiente: " + e.message);
  } finally {
    relayBusy = false;
  }
}

function startRelayPolling() {
  if (relayStarted) return;

  relayStarted = true;

  console.log("🔁 Relay polling activado: Suki preguntará tareas al panel cada 15 segundos.");

  setTimeout(() => registerWithPanel("startup").catch(() => {}), 2000);
  setInterval(() => registerWithPanel("refresh").catch(() => {}), RELAY_REGISTER_INTERVAL_MS);

  setTimeout(() => relayPollOnce().catch(() => {}), 5000);
  setInterval(() => relayPollOnce().catch(() => {}), RELAY_POLL_INTERVAL_MS);
}

function makeJsonBodyLimit(app) {
  app.use(express.json({ limit: "80mb" }));
  app.use(express.urlencoded({ extended: true, limit: "80mb" }));
}

function startWebServer(sock) {
  global.sukiSock = sock;
  global.sock = sock;

  if (global.__SUKI_WEB_SERVER_STARTED) {
    console.log("🌐 API web de Suki ya estaba iniciada, sock actualizado.");
    startRelayPolling();
    return;
  }

  global.__SUKI_WEB_SERVER_STARTED = true;

  const app = express();
  const PORT = getServerPort();

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
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null,
      port: PORT,
      pollIntervalMs: RELAY_POLL_INTERVAL_MS
    });
  });

  app.get("/api/status", authMiddleware, async (req, res) => {
    res.json({
      ok: true,
      connected: !!sock?.user,
      user: sock?.user || null,
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null,
      pollIntervalMs: RELAY_POLL_INTERVAL_MS
    });
  });

  app.post("/api/register-now", authMiddleware, async (req, res) => {
    const ok = await registerWithPanel("manual-api");

    res.json({
      ok,
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null
    });
  });

  app.get("/api/groups", authMiddleware, async (req, res) => {
    try {
      const groups = await getGroupsCached(sock, true);

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

  app.post("/api/groups/:chatId/group-mode", authMiddleware, async (req, res) => {
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const mode = String(req.body?.mode || "");

      const result = await applyGroupMode(sock, chatId, mode);

      lastGroupsAt = 0;

      res.json({
        ok: true,
        ...result
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
      const config = getAllConfigs(chatId) || {};

      config.reaccion = getReaccionStatus(chatId);

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

      const result = await applyConfig(sock, chatId, String(key || ""), value, true);

      res.json({
        ok: true,
        ...result
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
      const chatId = decodeURIComponent(req.params.chatId);

      try {
        await sock.sendMessage(chatId, {
          text:
`👋💜 *Suki se va del grupo...*

Mi dueño me sacó desde el panel web.

Gracias por usar *La Suki Bot*.  
Bye bye ✨🚀`
        });
      } catch {}

      await new Promise(resolve => setTimeout(resolve, 1200));

      await sock.groupLeave(chatId);

      lastGroupsAt = 0;

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 API web de La Suki Bot activa en puerto ${PORT}`);
    console.log(`🌐 Panel central: ${SUKI_PANEL_URL}`);
    console.log("🔁 Modo relay/polling listo.");
    console.log(`⏱️ Polling configurado cada ${RELAY_POLL_INTERVAL_MS / 1000} segundos.`);
    startRelayPolling();
  });
}

module.exports = {
  startWebServer
};
