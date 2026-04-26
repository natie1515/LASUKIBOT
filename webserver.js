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

const SUKI_PANEL_URL = "https://lasukibot.ultraplus.click";

const API_KEYS_PATH = path.resolve("./api_keys.json");
const WEB_SETTINGS_PATH = path.resolve("./web_settings.json");
const ACTIVOSS_PATH = path.resolve("./activoss.json");
const RELAY_STATE_PATH = path.resolve("./relay_client_state.json");

const RELAY_POLL_INTERVAL_MS = 15000;
const RELAY_REGISTER_INTERVAL_MS = 60000;

const GROUPS_CACHE_MS = 2 * 60 * 1000;
const GROUPS_FORCE_COOLDOWN_MS = 60 * 1000;
const GROUPS_FETCH_TIMEOUT_MS = 15000;

const TASK_RESULT_RETRY_ATTEMPTS = 5;
const TASK_RESULT_RETRY_DELAY_MS = 2500;
const FINISHED_TASK_TTL_MS = 10 * 60 * 1000;

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
let lastGroupsFetchAttemptAt = 0;
let lastRegisterOkAt = 0;

const runningTaskIds = new Set();
const finishedTaskIds = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidHash(value) {
  return /^[a-f0-9]{64}$/.test(String(value || "").trim().toLowerCase());
}

function cleanHash(value) {
  const text = String(value || "").trim().toLowerCase();
  if (isValidHash(text)) return text;

  const match = text.match(/[a-f0-9]{64}/i);
  return match ? match[0].toLowerCase() : "";
}

function shortHash(value) {
  const hash = String(value || "").trim();
  return hash ? hash.slice(0, 12) + "..." : "vacío";
}

function cleanupFinishedTasks() {
  const now = Date.now();

  for (const [taskId, finishedAt] of finishedTaskIds.entries()) {
    if (now - Number(finishedAt || 0) > FINISHED_TASK_TTL_MS) {
      finishedTaskIds.delete(taskId);
    }
  }
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return data && typeof data === "object" ? data : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data || {}, null, 2));
  } catch {}
}

function readKeys() {
  const data = readJSON(API_KEYS_PATH, []);
  return Array.isArray(data) ? data : [];
}

function readWebSettings() {
  return readJSON(WEB_SETTINGS_PATH, {});
}

function saveWebSettings(data) {
  saveJSON(WEB_SETTINGS_PATH, data || {});
}

function readActivoss() {
  return readJSON(ACTIVOSS_PATH, {});
}

function saveActivoss(data) {
  saveJSON(ACTIVOSS_PATH, data || {});
}

function readRelayState() {
  return readJSON(RELAY_STATE_PATH, {});
}

function saveRelayState(patch = {}) {
  const old = readRelayState();

  saveJSON(RELAY_STATE_PATH, {
    ...old,
    ...patch,
    updatedAt: Date.now()
  });
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function getHashFromKeyRecord(k = {}) {
  const fromHash = cleanHash(k.hash || k.keyHash || k.key_hash || k.primaryKeyHash || "");
  if (fromHash) return fromHash;

  const raw =
    k.key ||
    k.apiKey ||
    k.apikey ||
    k.rawKey ||
    k.token ||
    "";

  if (raw && typeof raw === "string" && raw.length >= 8) {
    return sha256(raw);
  }

  return "";
}

function verifyApiKey(rawKey) {
  if (!rawKey) return false;

  const hash = sha256(rawKey);
  const keys = readKeys();

  return keys.some(k => {
    const storedHash = getHashFromKeyRecord(k);
    return storedHash === hash && k.active !== false;
  });
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

function getLiveSock() {
  const currentSock = getSock();

  if (!currentSock) {
    throw new Error("Sock no disponible");
  }

  if (!currentSock.user) {
    throw new Error("WhatsApp no está conectado");
  }

  return currentSock;
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
    .filter(k => k && k.active !== false)
    .map(k => {
      const hash = getHashFromKeyRecord(k);

      return {
        id: k.id || "",
        hash,
        keyHash: hash,
        key_hash: hash,
        active: k.active !== false,
        createdAt: k.createdAt || null,
        createdBy: k.createdBy || null
      };
    })
    .filter(k => isValidHash(k.hash));
}

function getActiveKeyHashes() {
  const hashes = [];

  for (const k of getActiveKeyPayload()) {
    const hash = cleanHash(k.hash || k.keyHash);
    if (hash && !hashes.includes(hash)) hashes.push(hash);
  }

  const state = readRelayState();
  const fallback = cleanHash(state.primaryKeyHash || state.keyHash || "");

  if (fallback && !hashes.includes(fallback)) hashes.push(fallback);

  return hashes;
}

function getPrimaryKeyHash() {
  return getActiveKeyHashes()[0] || "";
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

async function sendGroupNotice(sock, chatId, text, reason = "notice") {
  try {
    if (!sock) throw new Error("Sock vacío");
    if (!sock.user) throw new Error("Sock sin usuario conectado");
    if (!chatId) throw new Error("chatId vacío");

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📢 ENVIANDO NOTIFICACIÓN AL GRUPO");
    console.log("➡️ Razón:", reason);
    console.log("➡️ ChatId:", chatId);
    console.log("➡️ Bot:", sock.user?.id || sock.user?.jid || sock.user);

    const sent = await sock.sendMessage(chatId, { text });

    console.log("✅ Notificación enviada correctamente:", reason);
    return sent;
  } catch (e) {
    console.log("❌ No se pudo enviar notificación");
    console.log("➡️ Razón:", reason);
    console.log("➡️ ChatId:", chatId);
    console.log("➡️ Error:", e.message);

    const msg = String(e.message || "").toLowerCase();

    if (
      msg.includes("not-authorized") ||
      msg.includes("forbidden") ||
      msg.includes("admin") ||
      msg.includes("not a participant")
    ) {
      console.log("⚠️ Posible causa: grupo cerrado, Suki no es admin o Suki ya no está en el grupo.");
    }

    return null;
  }
}

async function notifyConfig(sock, chatId, key, active) {
  const label = CONFIG_LABELS[key] || key;
  const estado = active ? "activada ✅" : "desactivada ❌";

  const text =
`⚙️✨ *Configuración actualizada desde el panel web*

${label} fue *${estado}*.

👑 Acción ejecutada por mi dueño desde el panel de *La Suki Bot*.`;

  return await sendGroupNotice(
    sock,
    chatId,
    text,
    `config:${key}:${active ? "on" : "off"}`
  );
}

async function notifyGroupMode(sock, chatId, mode) {
  let text;

  if (mode === "open") {
    text =
`🔓✨ *Grupo abierto*

Ahora todos los integrantes pueden enviar mensajes.

👑 Acción ejecutada desde el panel web de *La Suki Bot*.`;
  } else {
    text =
`🔒✨ *Grupo cerrado*

Ahora solo los administradores pueden enviar mensajes.

👑 Acción ejecutada desde el panel web de *La Suki Bot*.`;
  }

  return await sendGroupNotice(sock, chatId, text, `group_mode:${mode}`);
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

function isRateLimitError(e) {
  const msg = String(e?.message || e || "").toLowerCase();

  return (
    msg.includes("rate-overlimit") ||
    msg.includes("rate overlimit") ||
    msg.includes("rate-limit") ||
    msg.includes("too many") ||
    msg.includes("429")
  );
}

function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    })
  ]);
}

async function getGroups(sock) {
  if (!sock?.user) {
    throw new Error("WhatsApp no está conectado");
  }

  const groups = await withTimeout(
    sock.groupFetchAllParticipating(),
    GROUPS_FETCH_TIMEOUT_MS,
    "Timeout cargando grupos"
  );

  return Object.entries(groups || {}).map(([id, g]) => {
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

  if (!force && lastGroupsCache.length && now - lastGroupsAt < GROUPS_CACHE_MS) {
    return lastGroupsCache;
  }

  if (force && lastGroupsCache.length && now - lastGroupsAt < GROUPS_FORCE_COOLDOWN_MS) {
    console.log("♻️ Usando caché de grupos para evitar rate-overlimit.");
    return lastGroupsCache;
  }

  if (now - lastGroupsFetchAttemptAt < 10000 && lastGroupsCache.length) {
    console.log("♻️ Evitando doble carga de grupos muy seguida.");
    return lastGroupsCache;
  }

  lastGroupsFetchAttemptAt = now;

  try {
    const freshGroups = await getGroups(sock);

    lastGroupsCache = freshGroups;
    lastGroupsAt = Date.now();

    console.log("👥 Grupos cargados desde WhatsApp:", freshGroups.length);

    return lastGroupsCache;
  } catch (e) {
    console.log("⚠️ No se pudieron cargar grupos:", e.message);

    if (isRateLimitError(e) && lastGroupsCache.length) {
      console.log("♻️ Rate-overlimit detectado. Devolviendo caché de grupos:", lastGroupsCache.length);
      return lastGroupsCache;
    }

    if (lastGroupsCache.length) {
      console.log("♻️ Error cargando grupos. Devolviendo caché:", lastGroupsCache.length);
      return lastGroupsCache;
    }

    throw e;
  }
}

async function makeState(sock) {
  let groups = [];

  try {
    groups = await getGroupsCached(sock, false);
  } catch (e) {
    console.log("⚠️ No se pudieron cargar grupos para state:", e.message);

    if (lastGroupsCache.length) {
      groups = lastGroupsCache;
    }
  }

  return {
    connected: !!sock?.user,
    user: sock?.user || null,
    groups
  };
}

function buildPanelBody(reason, state = {}, extra = {}) {
  const keys = getActiveKeyPayload();
  const keyHashes = getActiveKeyHashes();
  const primaryKeyHash = keyHashes[0] || "";

  if (!primaryKeyHash) {
    console.log("⚠️ buildPanelBody sin primaryKeyHash válido.");
    console.log("➡️ Revisa api_keys.json: el campo hash debe ser SHA256 completo de 64 caracteres.");
  }

  return {
    botName: "La Suki Bot",
    publicUrl: getPublicBaseUrl(),
    reason,
    registeredAt: Date.now(),

    keys,
    hashes: keyHashes,
    keyHashes,
    activeKeys: keyHashes,
    activeKeyHashes: keyHashes,

    hash: primaryKeyHash,
    keyHash: primaryKeyHash,
    key_hash: primaryKeyHash,
    primaryHash: primaryKeyHash,
    primary_hash: primaryKeyHash,
    primaryKeyHash,
    primary_key_hash: primaryKeyHash,
    botHash: primaryKeyHash,
    bot_hash: primaryKeyHash,
    relayKeyHash: primaryKeyHash,

    user: state.user || null,
    groups: state.groups || [],
    state: {
      ...state,
      hash: primaryKeyHash,
      keyHash: primaryKeyHash,
      primaryHash: primaryKeyHash,
      primaryKeyHash
    },

    ...extra
  };
}

async function registerWithPanel(reason = "manual", stateOverride = null) {
  try {
    const keyHashes = getActiveKeyHashes();

    if (!keyHashes.length) {
      console.log("⚠️ No se registró Suki: no hay API keys activas con hash válido.");
      return false;
    }

    const sock = getSock();
    const state = stateOverride || (sock ? await makeState(sock) : {});
    const body = buildPanelBody(reason, state);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📡 REGISTRANDO SUKI EN PANEL");
    console.log("➡️ Razón:", reason);
    console.log("➡️ Keys:", keyHashes.length);
    console.log("➡️ Primary hash:", shortHash(keyHashes[0]));
    console.log("➡️ Grupos:", Array.isArray(state.groups) ? state.groups.length : 0);

    const res = await axios.post(`${SUKI_PANEL_URL}/api/register-bot`, body, {
      timeout: 20000,
      validateStatus: () => true
    });

    if (!res.data || res.data.ok !== true) {
      console.log("⚠️ Registro panel falló:", res.status, res.data);
      return false;
    }

    lastRegisterOkAt = Date.now();

    saveRelayState({
      primaryKeyHash: keyHashes[0] || "",
      keyHashes,
      lastRegisterOkAt,
      lastRegisterReason: reason,
      lastRegisterResponse: res.data
    });

    console.log(`✅ Suki registrada en panel central. Keys: ${res.data.saved}`);
    return true;
  } catch (e) {
    console.log("⚠️ Registro con panel pendiente:", e.message);
    return false;
  }
}

async function reportTaskResult(taskId, ok, result = {}, error = "") {
  const keyHashes = getActiveKeyHashes();
  const primaryKeyHash = keyHashes[0] || "";

  const body = {
    taskId,
    ok,
    result: result || {},
    error: error || "",
    botName: "La Suki Bot",
    publicUrl: getPublicBaseUrl(),

    hashes: keyHashes,
    keyHashes,
    activeKeyHashes: keyHashes,
    hash: primaryKeyHash,
    keyHash: primaryKeyHash,
    key_hash: primaryKeyHash,
    primaryHash: primaryKeyHash,
    primaryKeyHash,
    botHash: primaryKeyHash,

    finishedAt: Date.now()
  };

  for (let attempt = 1; attempt <= TASK_RESULT_RETRY_ATTEMPTS; attempt++) {
    try {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📤 REPORTANDO RESULTADO DE TASK AL PANEL");
      console.log("➡️ Task ID:", taskId);
      console.log("➡️ OK:", ok);
      console.log("➡️ Intento:", attempt + "/" + TASK_RESULT_RETRY_ATTEMPTS);
      console.log("➡️ Primary hash:", shortHash(primaryKeyHash));

      const res = await axios.post(`${SUKI_PANEL_URL}/api/bot/task-result`, body, {
        timeout: 30000,
        validateStatus: () => true
      });

      if (!res.data || res.data.ok !== true) {
        console.log("⚠️ Panel no aceptó resultado task:", taskId, res.status, res.data);

        if (attempt < TASK_RESULT_RETRY_ATTEMPTS) {
          await sleep(TASK_RESULT_RETRY_DELAY_MS);
          continue;
        }

        return false;
      }

      if (res.data.missing) {
        console.log("⚠️ Panel respondió que la task no existe:", taskId);
      }

      console.log("✅ Resultado de task confirmado por panel:", taskId);
      return true;
    } catch (e) {
      console.log("⚠️ No se pudo reportar task:", taskId, e.message);

      if (attempt < TASK_RESULT_RETRY_ATTEMPTS) {
        await sleep(TASK_RESULT_RETRY_DELAY_MS);
      }
    }
  }

  return false;
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

    console.log("👥 Grupos enviados al panel:", groups.length);

    return {
      groups,
      cached: true,
      total: groups.length
    };
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
    if (!fileBase64 || fileBase64 === "[limpiado]") throw new Error("Falta archivo");

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

    await sendGroupNotice(
      sock,
      chatId,
`👋💜 *Suki se va del grupo...*

Mi dueño me sacó desde el panel web.

Gracias por usar *La Suki Bot*.  
Bye bye ✨🚀`,
      "leave_group"
    );

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

function normalizeTasksFromPanel(data) {
  if (Array.isArray(data?.tasks)) return data.tasks;
  if (Array.isArray(data?.data?.tasks)) return data.data.tasks;
  if (Array.isArray(data?.result?.tasks)) return data.result.tasks;
  return [];
}

function logPollError(message, data) {
  const now = Date.now();

  if (now - lastPollErrorLogAt < 30000) return;

  lastPollErrorLogAt = now;

  if (data) {
    console.log(message, data);
  } else {
    console.log(message);
  }
}

async function executeAndReportTask(task) {
  const taskId = String(task?.id || "");

  if (!taskId) {
    console.log("⚠️ Task sin ID recibida. Ignorada.");
    return;
  }

  cleanupFinishedTasks();

  if (runningTaskIds.has(taskId)) {
    console.log("♻️ Task ya está ejecutándose. Ignorada para evitar duplicado:", taskId);
    return;
  }

  if (finishedTaskIds.has(taskId)) {
    console.log("♻️ Task ya fue ejecutada antes. Ignorada para evitar duplicado:", taskId);
    return;
  }

  runningTaskIds.add(taskId);

  try {
    const currentSock = getLiveSock();

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📥 EJECUTANDO TASK RECIBIDA");
    console.log("➡️ ID:", taskId);
    console.log("➡️ Tipo:", task.type);

    const result = await executeTask(currentSock, task);

    const reported = await reportTaskResult(taskId, true, result, "");

    if (reported) {
      finishedTaskIds.set(taskId, Date.now());
    }

    console.log("✅ Task ejecutada:", taskId);
  } catch (e) {
    console.log(`❌ Task #${taskId} error:`, e.message);

    const reported = await reportTaskResult(taskId, false, {}, e.message);

    if (reported) {
      finishedTaskIds.set(taskId, Date.now());
    }
  } finally {
    runningTaskIds.delete(taskId);
  }
}

async function postPollToPanel(body, label = "normal") {
  const res = await axios.post(`${SUKI_PANEL_URL}/api/bot/poll`, body, {
    timeout: 25000,
    validateStatus: () => true
  });

  if (!res.data || res.data.ok !== true) {
    logPollError(`⚠️ Poll panel falló (${label}): ${res.status}`, res.data);
    return {
      ok: false,
      tasks: [],
      data: res.data || null,
      status: res.status
    };
  }

  const tasks = normalizeTasksFromPanel(res.data);

  return {
    ok: true,
    tasks,
    data: res.data,
    status: res.status
  };
}

async function relayPollOnce() {
  if (relayBusy) return;

  relayBusy = true;

  try {
    const sock = getSock();
    if (!sock) return;

    const keyHashes = getActiveKeyHashes();

    if (!keyHashes.length) {
      console.log("⚠️ Poll cancelado: no hay API keys activas con hash válido en api_keys.json.");
      return;
    }

    const state = await makeState(sock);

    if (!lastRegisterOkAt || Date.now() - lastRegisterOkAt > RELAY_REGISTER_INTERVAL_MS) {
      await registerWithPanel("before-poll", state).catch(() => {});
    }

    const pollId = String(Date.now()) + "_" + crypto.randomBytes(3).toString("hex");

    const body = {
      ...buildPanelBody("poll", state, {
        pollId,
        pollAt: Date.now(),
        rescuePending: true,
        takeAnyPending: true
      })
    };

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📡 ENVIANDO POLL AL PANEL");
    console.log("➡️ Poll ID:", pollId);
    console.log("➡️ Panel:", SUKI_PANEL_URL);
    console.log("➡️ Keys:", keyHashes.length);
    console.log("➡️ Primary hash:", shortHash(keyHashes[0]));
    console.log("➡️ Connected:", !!state.connected);
    console.log("➡️ Groups state:", Array.isArray(state.groups) ? state.groups.length : 0);

    let poll = await postPollToPanel(body, "normal");

    if (!poll.ok) return;

    let tasks = poll.tasks;

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📡 POLL PANEL OK");
    console.log("➡️ Poll ID:", pollId);
    console.log("➡️ Tasks recibidas:", tasks.length);

    if (poll.data?.debug) {
      console.log("🧾 Debug panel:", poll.data.debug);
    }

    const debug = poll.data?.debug || {};
    const pendingTotal = Number(debug.pendingTotal || 0);
    const selected = Number(debug.selected || 0);

    if (!tasks.length && pendingTotal > 0 && selected === 0) {
      console.log("⚠️ El panel tiene tareas pendientes pero no entregó ninguna.");
      console.log("♻️ Reintentando poll de rescate con todos los hashes posibles...");

      const rescueBody = {
        ...body,
        reason: "poll-rescue",
        rescuePoll: true,
        forceTakePending: true,
        takeAnyPending: true,
        allowHashRescue: true,
        pollId: pollId + "_rescue"
      };

      poll = await postPollToPanel(rescueBody, "rescue");

      if (poll.ok) {
        tasks = poll.tasks;

        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.log("📡 POLL RESCUE OK");
        console.log("➡️ Poll ID:", rescueBody.pollId);
        console.log("➡️ Tasks recibidas:", tasks.length);

        if (poll.data?.debug) {
          console.log("🧾 Debug rescue:", poll.data.debug);
        }
      }
    }

    saveRelayState({
      primaryKeyHash: keyHashes[0] || "",
      keyHashes,
      lastPollAt: Date.now(),
      lastPollId: pollId,
      lastPollTasks: tasks.length,
      lastPanelDebug: poll.data?.debug || null
    });

    if (!tasks.length) {
      console.log("ℹ️ Panel respondió 0 tasks.");
      console.log("➡️ Si relay_tasks.json tiene pending, revisa que el task tenga este hash:");
      console.log("➡️ Hash que Suki está usando:", shortHash(keyHashes[0]));
      console.log("➡️ Si el task está en running, espera 2 minutos o bórralo para probar.");
      return;
    }

    for (const task of tasks) {
      await executeAndReportTask(task);
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
      pollIntervalMs: RELAY_POLL_INTERVAL_MS,
      groupsCacheMs: GROUPS_CACHE_MS,
      groupsForceCooldownMs: GROUPS_FORCE_COOLDOWN_MS,
      primaryKeyHash: shortHash(getPrimaryKeyHash()),
      activeKeys: getActiveKeyHashes().length
    });
  });

  app.get("/api/status", authMiddleware, async (req, res) => {
    const currentSock = getSock();

    res.json({
      ok: true,
      connected: !!currentSock?.user,
      user: currentSock?.user || null,
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null,
      pollIntervalMs: RELAY_POLL_INTERVAL_MS,
      groupsCache: lastGroupsCache.length,
      groupsLastUpdate: lastGroupsAt || null,
      primaryKeyHash: shortHash(getPrimaryKeyHash()),
      activeKeys: getActiveKeyHashes().length,
      runningTasks: Array.from(runningTaskIds),
      finishedTasksCount: finishedTaskIds.size,
      relayState: readRelayState()
    });
  });

  app.post("/api/register-now", authMiddleware, async (req, res) => {
    const ok = await registerWithPanel("manual-api");

    res.json({
      ok,
      relay: true,
      panelUrl: SUKI_PANEL_URL,
      publicUrl: getPublicBaseUrl() || null,
      primaryKeyHash: shortHash(getPrimaryKeyHash()),
      activeKeys: getActiveKeyHashes().length
    });
  });

  app.post("/api/poll-now", authMiddleware, async (req, res) => {
    try {
      await relayPollOnce();

      res.json({
        ok: true,
        message: "Poll ejecutado manualmente",
        primaryKeyHash: shortHash(getPrimaryKeyHash()),
        activeKeys: getActiveKeyHashes().length,
        relayState: readRelayState()
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.get("/api/groups", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();
      const groups = await getGroupsCached(currentSock, true);

      res.json({
        ok: true,
        total: groups.length,
        cached: true,
        groups
      });
    } catch (e) {
      console.log("❌ Error en /api/groups:", e.message);

      res.status(500).json({
        ok: false,
        error: e.message,
        cachedGroups: lastGroupsCache.length
      });
    }
  });

  app.post("/api/groups/:chatId/group-mode", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const chatId = decodeURIComponent(req.params.chatId);
      const mode = String(req.body?.mode || "");

      const result = await applyGroupMode(currentSock, chatId, mode);

      lastGroupsAt = 0;

      res.json({
        ok: true,
        ...result
      });
    } catch (e) {
      console.log("❌ Error en /api/groups/:chatId/group-mode:", e.message);

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
      console.log("❌ Error en /api/groups/:chatId/config GET:", e.message);

      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/groups/:chatId/config", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const chatId = decodeURIComponent(req.params.chatId);
      const { key, value } = req.body || {};

      const result = await applyConfig(
        currentSock,
        chatId,
        String(key || ""),
        value,
        true
      );

      res.json({
        ok: true,
        ...result
      });
    } catch (e) {
      console.log("❌ Error en /api/groups/:chatId/config POST:", e.message);

      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/send/text", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

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
          await currentSock.sendMessage(chatId, { text: String(text) });
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
      console.log("❌ Error en /api/send/text:", e.message);

      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/send/media", authMiddleware, upload.single("file"), async (req, res) => {
    try {
      const currentSock = getLiveSock();

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
          await currentSock.sendMessage(chatId, payload);
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
      console.log("❌ Error en /api/send/media:", e.message);

      res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  });

  app.post("/api/groups/:chatId/leave", authMiddleware, async (req, res) => {
    try {
      const currentSock = getLiveSock();

      const chatId = decodeURIComponent(req.params.chatId);

      await sendGroupNotice(
        currentSock,
        chatId,
`👋💜 *Suki se va del grupo...*

Mi dueño me sacó desde el panel web.

Gracias por usar *La Suki Bot*.  
Bye bye ✨🚀`,
        "leave_group_direct_api"
      );

      await new Promise(resolve => setTimeout(resolve, 1200));

      await currentSock.groupLeave(chatId);

      lastGroupsAt = 0;

      res.json({
        ok: true,
        chatId,
        left: true
      });
    } catch (e) {
      console.log("❌ Error en /api/groups/:chatId/leave:", e.message);

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
    console.log(`♻️ Caché de grupos: ${GROUPS_CACHE_MS / 1000}s`);
    console.log(`🛡️ Cooldown force grupos: ${GROUPS_FORCE_COOLDOWN_MS / 1000}s`);
    console.log(`🔑 Primary hash: ${shortHash(getPrimaryKeyHash())}`);
    console.log(`🔑 Keys activas: ${getActiveKeyHashes().length}`);
    startRelayPolling();
  });
}

module.exports = {
  startWebServer
};
