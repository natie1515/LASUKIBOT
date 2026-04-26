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
  fs.writeFileSync(API_KEYS_PATH, JSON.stringify(data || [], null, 2));
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

function makeApiKey() {
  const rawKey = "suki_" + crypto.randomBytes(32).toString("hex");
  const id = crypto.randomBytes(5).toString("hex");

  return {
    id,
    rawKey,
    hash: sha256(rawKey)
  };
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;

  if (!isOwnerMsg(msg) && !msg.key.fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ *Solo los owners pueden usar este comando.*"
    }, { quoted: msg });
  }

  const action = String(args[0] || "new").toLowerCase();

  if (action === "list" || action === "lista") {
    const keys = readKeys();

    if (!keys.length) {
      return conn.sendMessage(chatId, {
        text: "🔐 No hay API key creada."
      }, { quoted: msg });
    }

    const text = keys.map((k, i) => {
      return `${i + 1}. ID: *${k.id}*\n   Estado: ${k.active === false ? "❌ apagada" : "✅ activa"}\n   Creada: ${new Date(k.createdAt).toLocaleString()}`;
    }).join("\n\n");

    return conn.sendMessage(chatId, {
      text: `🔐 *API key actual:*\n\n${text}\n\n📌 Usa *.apikey* para generar una nueva y borrar la anterior.`
    }, { quoted: msg });
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
      return conn.sendMessage(chatId, {
        text: "❌ No hay API key para eliminar."
      }, { quoted: msg });
    }

    saveKeys([]);

    return conn.sendMessage(chatId, {
      text: "✅ Todas las API keys fueron eliminadas correctamente."
    }, { quoted: msg });
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
    active: true,
    createdAt: Date.now(),
    createdBy: DIGITS(sender),
    replacedOldKeys: oldKeys.length
  };

  // ✅ IMPORTANTE:
  // Aquí NO usamos push.
  // Esto borra todas las anteriores y deja solo esta nueva.
  saveKeys([newKeyData]);

  // ✅ Limpia estado viejo del relay para que el panel no siga viendo hashes anteriores.
  try {
    if (fs.existsSync(RELAY_STATE_PATH)) fs.unlinkSync(RELAY_STATE_PATH);
  } catch {}

  // ✅ Si la API web ya está viva, fuerza registro inmediato al panel central.
  try {
    if (typeof global.__SUKI_RELAY_REGISTER_NOW === "function") {
      global.__SUKI_RELAY_REGISTER_NOW("apikey-created");
    }
  } catch {}

  return conn.sendMessage(chatId, {
    text:
`🔐 *API key nueva creada correctamente*

ID: *${created.id}*

🧹 API keys anteriores eliminadas: *${oldKeys.length}*

Copia esta key y guárdala bien:

\`\`\`
${created.rawKey}
\`\`\`

⚠️ Por seguridad, esta key completa solo se muestra una vez.

✅ Ahora solo existe *1 API key activa*.`
  }, { quoted: msg });
};

handler.command = ["apikey", "api"];
module.exports = handler;
