// plugins/guarsk.js
// Guarda un sticker respondido con una palabra clave para animarlo después.
// Uso: .guarsk <palabra clave>  (respondiendo a un sticker)
// Ej:  .guarsk hola  /  .guarsk meme feliz

"use strict";

const fs = require("fs");
const path = require("path");

const STICKERS_DIR = path.resolve("./sticker_base");
const DB_FILE = path.resolve("./sticker_base.json");

// Crear carpeta si no existe
if (!fs.existsSync(STICKERS_DIR)) fs.mkdirSync(STICKERS_DIR, { recursive: true });

function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}

function ensureWA(wa, conn) {
  if (wa && wa.downloadContentFromMessage) return wa;
  if (conn && conn.wa && conn.wa.downloadContentFromMessage) return conn.wa;
  if (global.wa && global.wa.downloadContentFromMessage) return global.wa;
  return null;
}

function sanitizeKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("[guarsk] error guardando DB:", e);
  }
}

const handler = async (msg, { conn, wa, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/\D/g, "");

  // 🗝️ Palabra clave
  const keyword = (args || []).join(" ").trim();
  if (!keyword) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Debes indicar una palabra clave.*

✳️ Uso:
*${pref}guarsk <palabra clave>* (respondiendo a un sticker)

Ejemplos:
• ${pref}guarsk hola
• ${pref}guarsk meme feliz
• ${pref}guarsk bailando`,
    }, { quoted: msg });
  }

  const safeKey = sanitizeKey(keyword);
  if (!safeKey) {
    return conn.sendMessage(chatId, {
      text: `❌ Palabra clave inválida.`,
    }, { quoted: msg });
  }

  // 🎯 Verificar que haya sticker citado
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.stickerMessage) {
    return conn.sendMessage(chatId, {
      text: `⚠️ *Responde a un sticker para guardarlo.*`,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "💾", key: msg.key } });

  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys.");

    // Descargar sticker
    const stream = await WA.downloadContentFromMessage(quoted.stickerMessage, "sticker");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    if (!buffer.length) throw new Error("El sticker está vacío.");

    // Guardar archivo físico
    const fileName = `${safeKey}.webp`;
    const filePath = path.join(STICKERS_DIR, fileName);
    fs.writeFileSync(filePath, buffer);

    // Actualizar DB
    const db = loadDB();
    const alreadyExists = !!db[safeKey];
    db[safeKey] = {
      key: keyword,
      safeKey,
      path: filePath,
      savedBy: senderId,
      savedAt: new Date().toISOString(),
      size: buffer.length,
    };
    saveDB(db);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    return conn.sendMessage(chatId, {
      text:
`╭━━━━━━━━━━━━━━━━━━━━╮
   💾 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗚𝗨𝗔𝗥𝗗𝗔𝗗𝗢
╰━━━━━━━━━━━━━━━━━━━━╯

🗝️ *Palabra clave:* ${keyword}
📂 *Guardado como:* ${fileName}
💾 *Tamaño:* ${(buffer.length / 1024).toFixed(2)} KB
${alreadyExists ? "♻️ *Nota:* reemplazó el sticker anterior con la misma clave." : "🆕 *Nuevo sticker agregado.*"}

━━━━━━━━━━━━━━━━━━━━
🎬 Anímalo con: *${pref}anim ${keyword}*
📤 Envíalo con: *${pref}sk ${keyword}*
━━━━━━━━━━━━━━━━━━━━`,
    }, { quoted: msg });

  } catch (e) {
    console.error("[guarsk] error:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al guardar: \`${e.message}\``,
    }, { quoted: msg });
  }
};

handler.command = ["guarsk"];
handler.help = ["guarsk <palabra_clave>"];
handler.tags = ["stickers"];
module.exports = handler;
