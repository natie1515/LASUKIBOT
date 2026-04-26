"use strict";

// plugins/pluginsowner/Apikey.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_KEYS_PATH = path.resolve("./api_keys.json");
const RELAY_STATE_PATH = path.resolve("./relay_client_state.json");

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function shortHash(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 12) + "..." : "vacío";
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return data;
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readKeys() {
  const data = readJSON(API_KEYS_PATH, []);
  return Array.isArray(data) ? data : [];
}

function saveKeys(data) {
  const clean = Array.isArray(data) ? data : [];
  saveJSON(API_KEYS_PATH, clean);
}

function readRelayState() {
  return readJSON(RELAY_STATE_PATH, {});
}

function deleteRelayState() {
  try {
    if (fs.existsSync(RELAY_STATE_PATH)) {
      fs.unlinkSync(RELAY_STATE_PATH);
      return true;
    }
  } catch {}

  return false;
}

function isValidHash(value) {
  return /^[a-f0-9]{64}$/.test(String(value || "").trim().toLowerCase());
}

function getHashFromKeyRecord(k = {}) {
  const direct = String(
    k.hash ||
    k.keyHash ||
    k.key_hash ||
    k.primaryKeyHash ||
    k.primary_key_hash ||
    ""
  ).trim().toLowerCase();

  if (isValidHash(direct)) return direct;

  const raw =
    k.rawKey ||
    k.key ||
    k.apiKey ||
    k.apikey ||
    k.token ||
    "";

  if (raw && typeof raw === "string" && raw.length >= 8) {
    return sha256(raw);
  }

  return "";
}

function isOwnerMsg(msg) {
  try {
    const sender =
      msg.realJid ||
      msg.key?.participant ||
      msg.key?.remoteJid ||
      "";

    const numero = String(msg.realNumber || DIGITS(sender));

    if (msg.key?.fromMe) return true;

    if (typeof global.isOwner === "function") {
      if (global.isOwner(sender)) return true;
      if (global.isOwner(numero)) return true;
    }

    if (Array.isArray(global.owner)) {
      return global.owner.some((entry) => {
        if (Array.isArray(entry)) {
          return entry.some(x => DIGITS(x) === numero);
        }

        return DIGITS(entry) === numero;
      });
    }

    return false;
  } catch {
    return false;
  }
}

function makeApiKey() {
  const rawKey = "suki_" + crypto.randomBytes(32).toString("hex");
  const id = crypto.randomBytes(5).toString("hex");
  const hash = sha256(rawKey);

  return {
    id,
    rawKey,
    hash
  };
}

function formatDate(ts) {
  const n = Number(ts || 0);

  if (!n) return "Sin fecha";

  try {
    return new Date(n).toLocaleString();
  } catch {
    return "Sin fecha";
  }
}

async function sendText(conn, chatId, text, msg) {
  return conn.sendMessage(chatId, { text }, { quoted: msg });
}

async function triggerRelayRegister(reason = "apikey-command") {
  let registerOk = false;
  let pollOk = false;

  try {
    if (typeof global.__SUKI_RELAY_REGISTER_NOW === "function") {
      const result = await global.__SUKI_RELAY_REGISTER_NOW(reason);
      registerOk = result !== false;
    }
  } catch {
    registerOk = false;
  }

  try {
    if (typeof global.__SUKI_RELAY_POLL_NOW === "function") {
      const result = await global.__SUKI_RELAY_POLL_NOW();
      pollOk = result !== false;
    }
  } catch {
    pollOk = false;
  }

  return {
    registerOk,
    pollOk,
    relayLoaded:
      typeof global.__SUKI_RELAY_REGISTER_NOW === "function" ||
      typeof global.__SUKI_RELAY_POLL_NOW === "function"
  };
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  if (!isOwnerMsg(msg)) {
    return sendText(
      conn,
      chatId,
      "⛔ *Solo los owners pueden usar este comando.*",
      msg
    );
  }

  const action = String(args?.[0] || "new").trim().toLowerCase();

  if (["help", "ayuda", "menu"].includes(action)) {
    return sendText(
      conn,
      chatId,
`🔐 *Comando API Key*

Usos:

*.apikey*
Crea una API key nueva y elimina las anteriores.

*.apikey list*
Muestra las API keys guardadas.

*.apikey status*
Muestra estado del relay.

*.apikey refresh*
Fuerza registro inmediato con el panel.

*.apikey del*
Elimina todas las API keys.`,
      msg
    );
  }

  if (["list", "lista"].includes(action)) {
    const keys = readKeys();

    if (!keys.length) {
      return sendText(
        conn,
        chatId,
        "🔐 No hay API key creada.",
        msg
      );
    }

    const text = keys.map((k, i) => {
      const hash = getHashFromKeyRecord(k);

      return `${i + 1}. ID: *${k.id || "sin-id"}*
   Estado: ${k.active === false ? "❌ apagada" : "✅ activa"}
   Hash: \`${shortHash(hash)}\`
   Creada: ${formatDate(k.createdAt)}
   Creada por: ${k.createdBy || "desconocido"}`;
    }).join("\n\n");

    return sendText(
      conn,
      chatId,
`🔐 *API keys guardadas:*

${text}

📌 Usa *.apikey* para crear una nueva y borrar las anteriores.`,
      msg
    );
  }

  if (["status", "estado"].includes(action)) {
    const keys = readKeys();
    const activeKeys = keys.filter(k => k.active !== false);
    const hashes = keys.map(getHashFromKeyRecord).filter(Boolean);
    const relayState = readRelayState();

    return sendText(
      conn,
      chatId,
`🔐 *Estado API / Relay*

Keys totales: *${keys.length}*
Keys activas: *${activeKeys.length}*
Primary hash local: \`${shortHash(hashes[0] || "")}\`

Relay cargado: ${
  typeof global.__SUKI_RELAY_REGISTER_NOW === "function" ||
  typeof global.__SUKI_RELAY_POLL_NOW === "function"
    ? "✅ sí"
    : "❌ no"
}

Último registro OK: ${
  relayState.lastRegisterOkAt
    ? formatDate(relayState.lastRegisterOkAt)
    : "Sin registro"
}

Último poll: ${
  relayState.lastPollAt
    ? formatDate(relayState.lastPollAt)
    : "Sin poll"
}

Últimas tasks recibidas: *${relayState.lastPollTasks ?? 0}*
Grupos enviados al panel: *${relayState.lastPollGroupsSent ?? 0}*`,
      msg
    );
  }

  if (["refresh", "registrar", "register", "sync", "sincronizar"].includes(action)) {
    const keys = readKeys();

    if (!keys.length) {
      return sendText(
        conn,
        chatId,
        "❌ No hay API key activa. Usa *.apikey* primero.",
        msg
      );
    }

    const relay = await triggerRelayRegister("apikey-refresh");

    return sendText(
      conn,
      chatId,
`🔁 *Registro solicitado*

Relay cargado: ${relay.relayLoaded ? "✅ sí" : "❌ no"}
Registro enviado: ${relay.registerOk ? "✅ sí" : "⚠️ pendiente"}
Poll ejecutado: ${relay.pollOk ? "✅ sí" : "⚠️ pendiente"}

Si el relay no está cargado, reinicia Suki o asegúrate de que \`startWebServer(sock)\` se esté ejecutando.`,
      msg
    );
  }

  if (
    action === "del" ||
    action === "delete" ||
    action === "remove" ||
    action === "borrar" ||
    action === "eliminar"
  ) {
    const keys = readKeys();

    if (!keys.length) {
      return sendText(
        conn,
        chatId,
        "❌ No hay API key para eliminar.",
        msg
      );
    }

    saveKeys([]);
    const relayStateDeleted = deleteRelayState();

    await triggerRelayRegister("apikey-deleted");

    return sendText(
      conn,
      chatId,
`✅ *API keys eliminadas correctamente*

Keys eliminadas: *${keys.length}*
Relay state limpiado: ${relayStateDeleted ? "✅ sí" : "⚠️ no existía"}

📌 Ahora crea una nueva con *.apikey*.`,
      msg
    );
  }

  if (
    action !== "new" &&
    action !== "nuevo" &&
    action !== "nueva" &&
    action !== "crear" &&
    action !== "create"
  ) {
    return sendText(
      conn,
      chatId,
      "❌ Acción inválida. Usa *.apikey help* para ver opciones.",
      msg
    );
  }

  const sender =
    msg.realJid ||
    msg.key?.participant ||
    msg.key?.remoteJid ||
    "";

  const oldKeys = readKeys();
  const created = makeApiKey();

  const newKeyData = {
    id: created.id,
    hash: created.hash,
    keyHash: created.hash,
    key_hash: created.hash,
    active: true,
    createdAt: Date.now(),
    createdBy: DIGITS(sender),
    replacedOldKeys: oldKeys.length
  };

  saveKeys([newKeyData]);

  const relayStateDeleted = deleteRelayState();
  const relay = await triggerRelayRegister("apikey-created");

  return sendText(
    conn,
    chatId,
`🔐 *API key nueva creada correctamente*

ID: *${created.id}*
Hash: \`${shortHash(created.hash)}\`

🧹 API keys anteriores eliminadas: *${oldKeys.length}*
🧹 Relay state limpiado: ${relayStateDeleted ? "✅ sí" : "⚠️ no existía"}

Copia esta key y guárdala bien:

\`\`\`
${created.rawKey}
\`\`\`

⚠️ Por seguridad, esta key completa solo se muestra una vez.

Relay cargado: ${relay.relayLoaded ? "✅ sí" : "❌ no"}
Registro enviado al panel: ${relay.registerOk ? "✅ sí" : "⚠️ pendiente"}
Poll ejecutado: ${relay.pollOk ? "✅ sí" : "⚠️ pendiente"}

✅ Ahora solo existe *1 API key activa*.`,
    msg
  );
};

handler.command = ["apikey", "api"];
handler.tags = ["owner"];
handler.help = ["apikey"];

module.exports = handler;
