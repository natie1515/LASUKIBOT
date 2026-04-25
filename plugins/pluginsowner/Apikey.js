// plugins/pluginsowner/Apikey.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API_KEYS_PATH = path.resolve("./api_keys.json");

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

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

function saveKeys(data) {
  fs.writeFileSync(API_KEYS_PATH, JSON.stringify(data, null, 2));
}

function isOwnerMsg(msg) {
  try {
    const sender =
      msg.realJid ||
      msg.key?.participant ||
      msg.key?.remoteJid ||
      "";

    const numero = String(msg.realNumber || DIGITS(sender));

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

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  if (!isOwnerMsg(msg) && !msg.key.fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo los owners pueden usar este comando.*"
    }, { quoted: msg });
  }

  const action = String(args[0] || "new").toLowerCase();

  if (action === "list") {
    const keys = readKeys();

    if (!keys.length) {
      return conn.sendMessage(chatId, {
        text: "🔐 No hay API keys creadas."
      }, { quoted: msg });
    }

    const text = keys.map((k, i) => {
      return `${i + 1}. ID: *${k.id}*\n   Estado: ${k.active === false ? "❌ apagada" : "✅ activa"}\n   Creada: ${new Date(k.createdAt).toLocaleString()}`;
    }).join("\n\n");

    return conn.sendMessage(chatId, {
      text: `🔐 *API keys creadas:*\n\n${text}`
    }, { quoted: msg });
  }

  if (action === "del" || action === "delete" || action === "remove") {
    const id = String(args[1] || "").trim();

    if (!id) {
      return conn.sendMessage(chatId, {
        text: "✳️ Usa:\n\n.apikey del ID"
      }, { quoted: msg });
    }

    const keys = readKeys();
    const next = keys.filter(k => k.id !== id);

    if (next.length === keys.length) {
      return conn.sendMessage(chatId, {
        text: "❌ No encontré esa API key."
      }, { quoted: msg });
    }

    saveKeys(next);

    return conn.sendMessage(chatId, {
      text: `✅ API key *${id}* eliminada correctamente.`
    }, { quoted: msg });
  }

  const rawKey = "suki_" + crypto.randomBytes(32).toString("hex");
  const id = crypto.randomBytes(5).toString("hex");

  const sender =
    msg.realJid ||
    msg.key?.participant ||
    msg.key?.remoteJid ||
    "";

  const keys = readKeys();

  keys.push({
    id,
    hash: sha256(rawKey),
    active: true,
    createdAt: Date.now(),
    createdBy: DIGITS(sender)
  });

  saveKeys(keys);

  return conn.sendMessage(chatId, {
    text:
`🔐 *API key creada correctamente*

ID: *${id}*

Copia esta key y guárdala bien:

\`\`\`
${rawKey}
\`\`\`

⚠️ Por seguridad, esta key completa solo se muestra una vez.`
  }, { quoted: msg });
};

handler.command = ["apikey", "api"];
module.exports = handler;
