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
const GROUPS_FORCE_COOLDOWN_MS = 25 * 1000;
const GROUPS_FETCH_TIMEOUT_MS = 20000;
const MIN_GROUPS_FOR_COOLDOWN = Number(process.env.SUKI_MIN_GROUPS_FOR_COOLDOWN || 8);

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

// ✅ Alias para que el panel no falle si manda nombres diferentes.
// Ejemplo: bienvenida, welcomes, despedida, antisticker, reacion, etc.
const CONFIG_ALIASES = {
  welcome: "welcome",
  bienvenida: "welcome",
  bienvenidas: "welcome",
  welcomes: "welcome",

  despedidas: "despedidas",
  despedida: "despedidas",
  bye: "despedidas",
  byes: "despedidas",
  goodbye: "despedidas",

  antilink: "antilink",
  anti_link: "antilink",
  anti_links: "antilink",
  links: "antilink",

  linkall: "linkall",
  link_all: "linkall",
  all_links: "linkall",

  antidelete: "antidelete",
  anti_delete: "antidelete",
  antieliminar: "antidelete",

  modoadmins: "modoadmins",
  modo_admins: "modoadmins",
  onlyadmins: "modoadmins",
  only_admins: "modoadmins",
  admins: "modoadmins",

  antiarabe: "antiarabe",
  anti_arabe: "antiarabe",
  antiarab: "antiarabe",
  anti_arab: "antiarabe",

  antis: "antis",
  antisticker: "antis",
  antistickers: "antis",
  anti_sticker: "antis",
  anti_stickers: "antis",

  reaccion: "reaccion",
  reacion: "reaccion",
  reaction: "reaccion",
  reactions: "reaccion",
  reacciones: "reaccion"
};

// ✅ Alias de tasks para que el relay soporte distintos panel.js.
const TASK_TYPE_ALIASES = {
  get_status: "get_status",
  status: "get_status",
  ping: "get_status",

  get_groups: "get_groups",
  groups: "get_groups",
  list_groups: "get_groups",

  set_config: "set_config",
  config: "set_config",
  group_config: "set_config",
  set_group_config: "set_config",
  update_config: "set_config",
  update_group_config: "set_config",
  toggle_config: "set_config",
  activar_config: "set_config",
  deactivate_config: "set_config",

  group_mode: "group_mode",
  set_group_mode: "group_mode",
  update_group_mode: "group_mode",
  change_group_mode: "group_mode",
  open_group: "group_mode",
  close_group: "group_mode",

  send_text: "send_text",
  send_message: "send_text",
  send_msg: "send_text",
  message: "send_text",
  text: "send_text",
  broadcast_text: "send_text",

  send_media: "send_media",
  send_multimedia: "send_media",
  send_file: "send_media",
  send_document: "send_media",
  media: "send_media",
  multimedia: "send_media",
  broadcast_media: "send_media",

  leave_group: "leave_group",
  salir_grupo: "leave_group",
  leave: "leave_group"
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

function unique(values = []) {
  const out = [];

  for (const value of values) {
    const clean = cleanHash(value);
    if (clean && !out.includes(clean)) out.push(clean);
  }

  return out;
}

function normalizeKeyName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, "_");
}

function normalizeConfigKey(value) {
  const raw = normalizeKeyName(value);
  return CONFIG_ALIASES[raw] || raw;
}

function normalizeTaskType(value) {
  const raw = normalizeKeyName(value);
  return TASK_TYPE_ALIASES[raw] || raw;
}

function normalizeGroupMode(value, fallbackType = "") {
  const raw = normalizeKeyName(value || fallbackType);

  if ([
    "open",
    "abrir",
    "abierto",
    "not_announcement",
    "notannouncement",
    "unlocked",
    "public",
    "todos",
    "all"
  ].includes(raw)) {
    return "open";
  }

  if ([
    "close",
    "cerrar",
    "cerrado",
    "announcement",
    "locked",
    "private",
    "admins",
    "admin"
  ].includes(raw)) {
    return "close";
  }

  return raw;
}

function firstValue(...values) {
  for (const value of values) {
    if (typeof value === "undefined" || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    return value;
  }

  return undefined;
}

function normalizeTaskObject(task = {}) {
  const payload = {
    ...(task.payload || {}),
    ...(task.data || {}),
    ...(task.body || {}),
    ...(task.params || {})
  };

  const rawType = firstValue(
    task.type,
    task.action,
    task.name,
    task.command,
    payload.type,
    payload.action
  );

  const type = normalizeTaskType(rawType);

  const id = String(firstValue(
    task.id,
    task.taskId,
    task.task_id,
    task._id,
    payload.id,
    payload.taskId,
    payload.task_id
  ) || "");

  return {
    ...task,
    id,
    type,
    rawType,
    payload
  };
}

function normalizeChatId(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  // El panel a veces manda IDs encodeados dentro de URLs.
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parseChatIdsAny(...values) {
  const out = [];

  for (const value of values) {
    for (const chatId of parseChatIds(value)) {
      const clean = normalizeChatId(chatId);
      if (clean && !out.includes(clean)) out.push(clean);
    }
  }

  return out;
}

function cleanBase64(value) {
  let text = String(value || "").trim();

  if (!text || text === "[limpiado]") return "";

  // Soporta data URL: data:image/png;base64,AAAA...
  const dataUrlMatch = text.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    text = dataUrlMatch[2];
  }

  // Quita espacios y saltos por si el panel parte el base64.
  return text.replace(/\s+/g, "");
}

function bufferFromBase64(value) {
  const cleaned = cleanBase64(value);
  if (!cleaned) return null;

  const buffer = Buffer.from(cleaned, "base64");
  if (!buffer.length) return null;

  return buffer;
}

function guessMimeFromName(fileName = "") {
  const name = String(fileName || "").toLowerCase();

  if (/\.(jpg|jpeg)$/.test(name)) return "image/jpeg";
  if (/\.png$/.test(name)) return "image/png";
  if (/\.webp$/.test(name)) return "image/webp";
  if (/\.gif$/.test(name)) return "image/gif";
  if (/\.mp4$/.test(name)) return "video/mp4";
  if (/\.webm$/.test(name)) return "video/webm";
  if (/\.(mp3|mpeg)$/.test(name)) return "audio/mpeg";
  if (/\.ogg$/.test(name)) return "audio/ogg";
  if (/\.wav$/.test(name)) return "audio/wav";
  if (/\.pdf$/.test(name)) return "application/pdf";

  return "application/octet-stream";
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

function collectHashesDeep(value, out = [], depth = 0) {
  if (depth > 8) return out;
  if (typeof value === "undefined" || value === null) return out;

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value || "").trim().toLowerCase();

    if (isValidHash(text)) {
      out.push(text);
      return out;
    }

    const matches = text.match(/[a-f0-9]{64}/gi);
    if (matches) {
      for (const m of matches) out.push(m.toLowerCase());
    }

    return out;
  }

  if (Array.isArray(value)) {
    value.forEach(v => collectHashesDeep(v, out, depth + 1));
    return out;
  }

  if (typeof value === "object") {
    Object.keys(value).forEach(k => collectHashesDeep(value[k], out, depth + 1));
  }

  return out;
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

function getKnownHashesFromLocalFiles() {
  const hashes = [];

  // ✅ Solo api_keys.json y variables de entorno.
  // ❌ No se lee relay_client_state.json aquí porque guarda hashes viejos.
  // Eso puede provocar que el panel entregue tareas a una key vieja y Suki no las tome bien.
  try {
    collectHashesDeep(readJSON(API_KEYS_PATH, []), hashes);
  } catch {}

  try {
    const envHashes = String(process.env.PANEL_KEY_HASHES || process.env.SUKI_PANEL_HASHES || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);

    collectHashesDeep(envHashes, hashes);
  } catch {}

  return unique(hashes);
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

  return hashes;
}

function getAllPanelHashes() {
  return unique([
    ...getActiveKeyHashes(),
    ...getKnownHashesFromLocalFiles()
  ]);
}

function getPrimaryKeyHash() {
  return getActiveKeyHashes()[0] || getAllPanelHashes()[0] || "";
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
  chatId = normalizeChatId(chatId);
  mode = normalizeGroupMode(mode);

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
  chatId = normalizeChatId(chatId);
  key = normalizeConfigKey(key);

  if (!chatId) throw new Error("Falta chatId");
  if (!CONFIG_KEYS.has(key)) throw new Error(`Config no permitida: ${key}`);

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

function normalizeGroupObject(id, g = {}) {
  const config = getAllConfigs(id) || {};
  config.reaccion = getReaccionStatus(id);

  return {
    id,
    subject: g.subject || "Sin nombre",
    owner: g.owner || null,
    announce: !!g.announce,
    restrict: !!g.restrict,
    participants: Array.isArray(g.participants)
      ? g.participants.length
      : Number(g.participants || g.participantsCount || 0),
    config
  };
}

function mergeGroups(oldGroups = [], newGroups = []) {
  const map = new Map();

  for (const g of oldGroups || []) {
    if (g?.id) map.set(String(g.id), g);
  }

  for (const g of newGroups || []) {
    if (g?.id) {
      const old = map.get(String(g.id)) || {};
      map.set(String(g.id), {
        ...old,
        ...g,
        config: {
          ...(old.config || {}),
          ...(g.config || {})
        }
      });
    }
  }

  return Array.from(map.values());
}

function setGroupsCache(groups = [], reason = "update", allowShrink = false) {
  const incoming = Array.isArray(groups) ? groups.filter(g => g?.id) : [];

  if (!incoming.length && lastGroupsCache.length) {
    console.log("⚠️ No se actualizó caché porque llegaron 0 grupos. Razón:", reason);
    return lastGroupsCache;
  }

  if (!allowShrink && lastGroupsCache.length && incoming.length < lastGroupsCache.length) {
    const merged = mergeGroups(lastGroupsCache, incoming);

    console.log("⚠️ Evité bajar caché de grupos.");
    console.log("➡️ Razón:", reason);
    console.log("➡️ Cache anterior:", lastGroupsCache.length);
    console.log("➡️ Entrante:", incoming.length);
    console.log("➡️ Merge final:", merged.length);

    lastGroupsCache = merged;
    lastGroupsAt = Date.now();

    return lastGroupsCache;
  }

  lastGroupsCache = incoming;
  lastGroupsAt = Date.now();

  console.log("✅ Caché de grupos actualizada.");
  console.log("➡️ Razón:", reason);
  console.log("➡️ Total:", lastGroupsCache.length);

  return lastGroupsCache;
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

  return Object.entries(groups || {}).map(([id, g]) => normalizeGroupObject(id, g));
}

async function getGroupsCached(sock, force = false, allowShrink = false) {
  const now = Date.now();

  if (!force && lastGroupsCache.length && now - lastGroupsAt < GROUPS_CACHE_MS) {
    return lastGroupsCache;
  }

  if (
    force &&
    lastGroupsCache.length >= MIN_GROUPS_FOR_COOLDOWN &&
    now - lastGroupsAt < GROUPS_FORCE_COOLDOWN_MS
  ) {
    console.log("♻️ Usando caché estable de grupos para evitar rate-overlimit.");
    console.log("➡️ Cache:", lastGroupsCache.length);
    return lastGroupsCache;
  }

  if (
    now - lastGroupsFetchAttemptAt < 10000 &&
    lastGroupsCache.length >= MIN_GROUPS_FOR_COOLDOWN
  ) {
    console.log("♻️ Evitando doble carga de grupos muy seguida.");
    console.log("➡️ Cache:", lastGroupsCache.length);
    return lastGroupsCache;
  }

  lastGroupsFetchAttemptAt = now;

  try {
    const freshGroups = await getGroups(sock);
    console.log("👥 Grupos cargados desde WhatsApp:", freshGroups.length);

    return setGroupsCache(freshGroups, force ? "force-fetch" : "fetch", allowShrink);
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

async function makeState(sock, forceGroups = false) {
  let groups = [];

  try {
    groups = await getGroupsCached(sock, forceGroups, false);
  } catch (e) {
    console.log("⚠️ No se pudieron cargar grupos para state:", e.message);

    if (lastGroupsCache.length) {
      groups = lastGroupsCache;
    }
  }

  return {
    connected: !!sock?.user,
    user: sock?.user || null,
    groups,
    groups_json: JSON.stringify(groups),
    group_cache: groups,
    groups_cache: groups
  };
}

function buildPanelKeyPayload() {
  const active = getActiveKeyPayload();
  const activeHashes = active.map(k => k.hash);
  const allHashes = getAllPanelHashes();

  const out = [];

  for (const hash of allHashes) {
    const found = active.find(k => k.hash === hash);

    out.push({
      id: found?.id || hash.slice(0, 12),
      hash,
      keyHash: hash,
      key_hash: hash,
      active: true,
      createdAt: found?.createdAt || null,
      createdBy: found?.createdBy || null
    });
  }

  return out;
}

function buildPanelBody(reason, state = {}, extra = {}) {
  const keys = buildPanelKeyPayload();
  const keyHashes = unique(keys.map(k => k.hash));
  const primaryKeyHash = getPrimaryKeyHash();

  const groups = Array.isArray(state.groups) ? state.groups : [];

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
    allKeyHashes: keyHashes,

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

    groups,
    groups_json: JSON.stringify(groups),
    group_cache: groups,
    groups_cache: groups,
    groupsCount: groups.length,

    state: {
      ...state,
      connected: !!state.connected,
      user: state.user || null,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups,
      groupsCount: groups.length,
      hash: primaryKeyHash,
      keyHash: primaryKeyHash,
      primaryHash: primaryKeyHash,
      primaryKeyHash,
      hashes: keyHashes,
      keyHashes,
      activeKeyHashes: keyHashes
    },

    ...extra
  };
}

async function registerWithPanel(reason = "manual", stateOverride = null) {
  try {
    const keyHashes = getAllPanelHashes();

    if (!keyHashes.length) {
      console.log("⚠️ No se registró Suki: no hay API keys activas con hash válido.");
      return false;
    }

    const sock = getSock();
    const state = stateOverride || (sock ? await makeState(sock, true) : {});
    const body = buildPanelBody(reason, state);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📡 REGISTRANDO SUKI EN PANEL");
    console.log("➡️ Razón:", reason);
    console.log("➡️ Keys conocidas:", keyHashes.length);
    console.log("➡️ Primary hash:", shortHash(getPrimaryKeyHash()));
    console.log("➡️ Hashes enviados:", keyHashes.map(shortHash).join(", "));
    console.log("➡️ Grupos enviados:", Array.isArray(body.groups) ? body.groups.length : 0);

    const res = await axios.post(`${SUKI_PANEL_URL}/api/register-bot`, body, {
      timeout: 25000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true
    });

    if (!res.data || res.data.ok !== true) {
      console.log("⚠️ Registro panel falló:", res.status, res.data);
      return false;
    }

    lastRegisterOkAt = Date.now();

    saveRelayState({
      primaryKeyHash: getPrimaryKeyHash(),
      keyHashes,
      lastRegisterOkAt,
      lastRegisterReason: reason,
      lastRegisterSentGroups: Array.isArray(body.groups) ? body.groups.length : 0,
      lastRegisterResponse: res.data
    });

    console.log(`✅ Suki registrada en panel central. Keys: ${res.data.saved}`);
    console.log("➡️ Panel dice grupos:", res.data.groups ?? "sin campo groups");

    return true;
  } catch (e) {
    console.log("⚠️ Registro con panel pendiente:", e.message);
    return false;
  }
}

async function reportTaskResult(taskId, ok, result = {}, error = "") {
  const keyHashes = getAllPanelHashes();
  const primaryKeyHash = getPrimaryKeyHash();

  const body = {
    taskId,
    task_id: taskId,
    id: taskId,
    ok,
    result: result || {},
    error: error || "",
    botName: "La Suki Bot",
    publicUrl: getPublicBaseUrl(),

    hashes: keyHashes,
    keyHashes,
    activeKeyHashes: keyHashes,
    allKeyHashes: keyHashes,

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
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
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
  task = normalizeTaskObject(task);

  const type = normalizeTaskType(task.type);
  const payload = task.payload || {};

  console.log(`📥 Ejecutando task #${task.id}: ${type}`);
  console.log("➡️ Payload keys:", Object.keys(payload).join(", ") || "sin payload");

  if (type === "get_status") {
    return {
      connected: !!sock?.user,
      user: sock?.user || null
    };
  }

  if (type === "get_groups") {
    const groups = await getGroupsCached(sock, true, false);

    console.log("👥 Grupos enviados al panel:", groups.length);

    return {
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups,
      cached: true,
      total: groups.length
    };
  }

  if (type === "set_config") {
    const chatId = normalizeChatId(firstValue(
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    ));

    const key = normalizeConfigKey(firstValue(
      payload.key,
      payload.configKey,
      payload.config_key,
      payload.name,
      payload.setting,
      payload.option
    ));

    const value = firstValue(
      payload.value,
      payload.active,
      payload.enabled,
      payload.status,
      payload.state,
      payload.on,
      true
    );

    const data = await applyConfig(sock, chatId, key, value, true);
    const groups = await getGroupsCached(sock, true, false).catch(() => lastGroupsCache);

    return {
      ...data,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups
    };
  }

  if (type === "group_mode") {
    const chatId = normalizeChatId(firstValue(
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    ));

    const mode = normalizeGroupMode(firstValue(
      payload.mode,
      payload.value,
      payload.status,
      payload.state
    ), task.rawType || task.type);

    const data = await applyGroupMode(sock, chatId, mode);

    lastGroupsAt = 0;

    const groups = await getGroupsCached(sock, true, false).catch(() => lastGroupsCache);

    return {
      ...data,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups
    };
  }

  if (type === "send_text") {
    const text = String(firstValue(
      payload.text,
      payload.message,
      payload.msg,
      payload.body,
      payload.content,
      payload.caption
    ) || "");

    const chatIds = parseChatIdsAny(
      payload.chatIds,
      payload.chat_ids,
      payload.groups,
      payload.groupIds,
      payload.group_ids,
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    );

    if (!text) throw new Error("Falta text/message");
    if (!chatIds.length) throw new Error("Falta chatId/chatIds");

    const results = [];

    for (const chatId of chatIds) {
      try {
        await sock.sendMessage(chatId, { text });
        results.push({ chatId, ok: true });
      } catch (e) {
        console.log("❌ send_text falló:", chatId, e.message);
        results.push({ chatId, ok: false, error: e.message });
      }
    }

    return {
      results,
      total: results.length,
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length
    };
  }

  if (type === "send_media") {
    const chatIds = parseChatIdsAny(
      payload.chatIds,
      payload.chat_ids,
      payload.groups,
      payload.groupIds,
      payload.group_ids,
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    );

    const caption = String(firstValue(payload.caption, payload.text, payload.message, "") || "");
    const fileName = String(firstValue(payload.fileName, payload.filename, payload.name, "archivo.bin") || "archivo.bin");
    const mimetype = String(firstValue(payload.mimetype, payload.mimeType, payload.mime, guessMimeFromName(fileName)) || "application/octet-stream");
    const fileBase64 = firstValue(
      payload.fileBase64,
      payload.base64,
      payload.file,
      payload.data,
      payload.buffer,
      payload.media,
      payload.mediaBase64,
      payload.media_base64
    );

    if (!chatIds.length) throw new Error("Falta chatId/chatIds");

    const buffer = Buffer.isBuffer(fileBase64)
      ? fileBase64
      : bufferFromBase64(fileBase64);

    if (!buffer) throw new Error("Falta archivo/base64");

    let msgPayload;

    if (mimetype.startsWith("image/")) {
      msgPayload = { image: buffer, caption };
    } else if (mimetype.startsWith("video/")) {
      msgPayload = { video: buffer, caption, mimetype };
    } else if (mimetype.startsWith("audio/")) {
      msgPayload = {
        audio: buffer,
        mimetype,
        ptt: payload.ptt === true || String(payload.ptt || "").toLowerCase() === "true"
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
        console.log("❌ send_media falló:", chatId, e.message);
        results.push({ chatId, ok: false, error: e.message });
      }
    }

    return {
      results,
      total: results.length,
      success: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length
    };
  }

  if (type === "leave_group") {
    const chatId = normalizeChatId(firstValue(
      payload.chatId,
      payload.chat_id,
      payload.groupId,
      payload.group_id,
      payload.jid,
      payload.remoteJid
    ));

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

    const groups = await getGroupsCached(sock, true, true).catch(() => lastGroupsCache);

    return {
      chatId,
      left: true,
      groups,
      groups_json: JSON.stringify(groups),
      group_cache: groups,
      groups_cache: groups
    };
  }

  throw new Error(`Task desconocida: ${task.type}`);
}

function normalizeTasksFromPanel(data) {
  let tasks = [];

  if (Array.isArray(data?.tasks)) tasks = data.tasks;
  else if (Array.isArray(data?.data?.tasks)) tasks = data.data.tasks;
  else if (Array.isArray(data?.result?.tasks)) tasks = data.result.tasks;
  else if (data?.task && typeof data.task === "object") tasks = [data.task];
  else if (data?.data?.task && typeof data.data.task === "object") tasks = [data.data.task];

  return tasks
    .filter(Boolean)
    .map(t => normalizeTaskObject(t));
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
  task = normalizeTaskObject(task);
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
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
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

    const keyHashes = getAllPanelHashes();

    if (!keyHashes.length) {
      console.log("⚠️ Poll cancelado: no hay API keys activas con hash válido en api_keys.json.");
      return;
    }

    const state = await makeState(sock, false);

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
    console.log("➡️ Primary hash:", shortHash(getPrimaryKeyHash()));
    console.log("➡️ Hashes:", keyHashes.map(shortHash).join(", "));
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
      primaryKeyHash: getPrimaryKeyHash(),
      keyHashes,
      lastPollAt: Date.now(),
      lastPollId: pollId,
      lastPollTasks: tasks.length,
      lastPollGroupsSent: Array.isArray(body.groups) ? body.groups.length : 0,
      lastPanelDebug: poll.data?.debug || null
    });

    if (!tasks.length) {
      console.log("ℹ️ Panel respondió 0 tasks.");
      console.log("➡️ Hash que Suki está usando:", shortHash(getPrimaryKeyHash()));
      console.log("➡️ Grupos que Suki está mandando:", Array.isArray(body.groups) ? body.groups.length : 0);
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

  // ✅ Permite que comandos como .apikey pidan re-registro inmediato sin reiniciar.
  global.__SUKI_RELAY_REGISTER_NOW = (reason = "manual-global") => {
    return registerWithPanel(reason).catch(e => {
      console.log("⚠️ Registro global falló:", e.message);
      return false;
    });
  };

  global.__SUKI_RELAY_POLL_NOW = () => {
    return relayPollOnce().catch(e => {
      console.log("⚠️ Poll global falló:", e.message);
      return false;
    });
  };

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
      activeKeys: getActiveKeyHashes().length,
      allPanelHashes: getAllPanelHashes().map(shortHash),
      groupsCache: lastGroupsCache.length
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
      allPanelHashes: getAllPanelHashes().map(shortHash),
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
      activeKeys: getActiveKeyHashes().length,
      allPanelHashes: getAllPanelHashes().map(shortHash),
      groupsCache: lastGroupsCache.length
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
        allPanelHashes: getAllPanelHashes().map(shortHash),
        groupsCache: lastGroupsCache.length,
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
      const groups = await getGroupsCached(currentSock, true, false);

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

      const chatId = normalizeChatId(req.params.chatId);
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
      const chatId = normalizeChatId(req.params.chatId);
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

      const chatId = normalizeChatId(req.params.chatId);
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
      const chatIds = parseChatIdsAny(
        req.body.chatIds,
        req.body.chat_ids,
        req.body.groups,
        req.body.groupIds,
        req.body.group_ids,
        req.body.chatId,
        req.body.chat_id,
        req.body.groupId,
        req.body.group_id,
        req.body.jid,
        req.body.remoteJid
      );

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

      const chatIds = parseChatIdsAny(
        req.body.chatIds,
        req.body.chat_ids,
        req.body.groups,
        req.body.groupIds,
        req.body.group_ids,
        req.body.chatId,
        req.body.chat_id,
        req.body.groupId,
        req.body.group_id,
        req.body.jid,
        req.body.remoteJid
      );
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

      const chatId = normalizeChatId(req.params.chatId);

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

      const groups = await getGroupsCached(currentSock, true, true).catch(() => lastGroupsCache);

      res.json({
        ok: true,
        chatId,
        left: true,
        groups
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
    console.log(`🔑 Hashes conocidos: ${getAllPanelHashes().map(shortHash).join(", ") || "ninguno"}`);
    startRelayPolling();
  });
}

module.exports = {
  startWebServer
};
