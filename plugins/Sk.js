// plugins/sk.js
// Envía un sticker guardado por palabra clave (base o animado si existe).
// Uso: .sk <palabra clave>
// Ej:  .sk hola  /  .sk meme feliz

"use strict";

const fs = require("fs");
const path = require("path");

const DB_FILE = path.resolve("./sticker_base.json");
const ANIM_DIR = path.resolve("./sticker_anim");

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
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } catch { return {}; }
}

// Busca todas las versiones animadas guardadas de esta palabra clave
function findAnimatedVersions(safeKey) {
  if (!fs.existsSync(ANIM_DIR)) return [];
  try {
    const files = fs.readdirSync(ANIM_DIR);
    return files
      .filter(f => f.startsWith(`${safeKey}_`) && f.endsWith(".webp"))
      .map(f => ({
        name: f,
        path: path.join(ANIM_DIR, f),
        anim: f.replace(`${safeKey}_`, "").replace(".webp", ""),
      }));
  } catch {
    return [];
  }
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  const keyword = (args || []).join(" ").trim();
  if (!keyword) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Indica la palabra clave del sticker.*

✳️ Uso:
*${pref}sk <palabra clave>*

Ejemplos:
• ${pref}sk hola
• ${pref}sk meme feliz

💡 Para ver todos los stickers guardados: *${pref}versk*`,
    }, { quoted: msg });
  }

  const safeKey = sanitizeKey(keyword);
  const db = loadDB();
  const entry = db[safeKey];

  // Buscar animadas primero (última animación = más reciente)
  const animated = findAnimatedVersions(safeKey);

  let stickerPath = null;
  let tipo = "base";
  let extraInfo = "";

  if (animated.length > 0) {
    // Usar la animación más reciente (o la primera)
    const mostRecent = animated
      .map(a => ({ ...a, mtime: fs.statSync(a.path).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    stickerPath = mostRecent.path;
    tipo = "animado";
    extraInfo = `🎬 Animación: *${mostRecent.anim}*`;
  } else if (entry && fs.existsSync(entry.path)) {
    stickerPath = entry.path;
    tipo = "base";
  }

  if (!stickerPath) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *No hay sticker con esa palabra clave.*

🗝️ Buscado: \`${keyword}\`

Guárdalo con:
*${pref}guarsk ${keyword}* (respondiendo a un sticker)`,
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "📤", key: msg.key } });
    await conn.sendMessage(chatId, { sticker: { url: stickerPath } }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    console.error("[sk] error:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al enviar: \`${e.message}\``,
    }, { quoted: msg });
  }
};

handler.command = ["sk"];
handler.help = ["sk <palabra_clave>"];
handler.tags = ["stickers"];
module.exports = handler;
