// plugins/sk.js
// Envía un sticker .was guardado por palabra clave.
// Si hay varios efectos guardados, envía el más reciente.
//
// Uso: .sk <palabra>

"use strict";

const fs = require("fs");
const path = require("path");

const ANIM_DIR = path.resolve("./sticker_anim");
const DB_FILE = path.resolve("./sticker_base.json");

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

function findAnimatedVersions(safeKey) {
  if (!fs.existsSync(ANIM_DIR)) return [];
  try {
    const files = fs.readdirSync(ANIM_DIR);
    return files
      .filter(f => f.startsWith(`${safeKey}_`) && f.endsWith(".was"))
      .map(f => ({
        name: f,
        path: path.join(ANIM_DIR, f),
        efecto: f.replace(`${safeKey}_`, "").replace(".was", ""),
        mtime: fs.statSync(path.join(ANIM_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
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
*${pref}sk <palabra>*

Ejemplos:
• ${pref}sk hola
• ${pref}sk cara feliz

💡 Para ver todos: *${pref}versk*`,
    }, { quoted: msg });
  }

  const safeKey = sanitizeKey(keyword);
  const animated = findAnimatedVersions(safeKey);

  if (animated.length === 0) {
    const db = loadDB();
    const hasBase = !!(db[safeKey] && fs.existsSync(db[safeKey].path));

    return conn.sendMessage(chatId, {
      text: hasBase
        ? `⚠️ *Todavía no hay sticker animado con esa palabra.*

La imagen *${keyword}* está guardada pero aún no has creado un sticker .was con ella.

🎬 Crea uno con:
*${pref}anim ${keyword}* (respondiendo a un sticker .was)`
        : `⚠️ *No hay sticker con esa palabra clave.*

🗝️ Buscado: \`${keyword}\`

1) Guarda una imagen:
   *${pref}guarsk ${keyword}* (respondiendo a la imagen)

2) Crea el sticker animado:
   *${pref}anim ${keyword}* (respondiendo a un sticker .was)`,
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "📤", key: msg.key } });

    // Enviar el .was más reciente
    const mostRecent = animated[0];
    await conn.sendMessage(chatId, {
      sticker: fs.readFileSync(mostRecent.path),
      mimetype: "application/was",
    }, { quoted: msg });

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
handler.help = ["sk <palabra>"];
handler.tags = ["stickers"];
module.exports = handler;
