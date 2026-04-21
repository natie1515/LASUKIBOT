// plugins/versk.js
// Muestra la lista de stickers guardados con .guarsk
// Uso: .versk

"use strict";

const fs = require("fs");
const path = require("path");

const DB_FILE = path.resolve("./sticker_base.json");
const ANIM_DIR = path.resolve("./sticker_anim");

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } catch { return {}; }
}

function countAnimations(safeKey) {
  if (!fs.existsSync(ANIM_DIR)) return 0;
  try {
    const files = fs.readdirSync(ANIM_DIR);
    return files.filter(f => f.startsWith(`${safeKey}_`) && f.endsWith(".webp")).length;
  } catch {
    return 0;
  }
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  await conn.sendMessage(chatId, { react: { text: "📋", key: msg.key } });

  const db = loadDB();
  const keys = Object.keys(db);

  if (keys.length === 0) {
    return conn.sendMessage(chatId, {
      text:
`📂 *No hay stickers guardados aún.*

Guarda uno con:
*${pref}guarsk <palabra clave>* (respondiendo a un sticker)`,
    }, { quoted: msg });
  }

  // Limpiar entradas cuyos archivos ya no existen
  let cambios = false;
  for (const k of keys) {
    const entry = db[k];
    if (!entry?.path || !fs.existsSync(entry.path)) {
      delete db[k];
      cambios = true;
    }
  }
  if (cambios) {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch {}
  }

  const validKeys = Object.keys(db).sort();
  if (validKeys.length === 0) {
    return conn.sendMessage(chatId, {
      text: `📂 *No hay stickers válidos guardados.*`,
    }, { quoted: msg });
  }

  const mentions = [];
  let texto = `╭━━━━━━━━━━━━━━━━━━━━╮\n   📋 𝗦𝗧𝗜𝗖𝗞𝗘𝗥𝗦 𝗚𝗨𝗔𝗥𝗗𝗔𝗗𝗢𝗦\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n`;

  let total = 0;
  for (const safeKey of validKeys) {
    const entry = db[safeKey];
    total++;
    const numAnim = countAnimations(safeKey);
    const userNum = entry.savedBy ? String(entry.savedBy).replace(/\D/g, "") : null;
    const userJid = userNum ? `${userNum}@s.whatsapp.net` : null;
    if (userJid && !mentions.includes(userJid)) mentions.push(userJid);

    texto += `🗝️ *${entry.key || safeKey}*\n`;
    if (userNum) texto += `   👤 @${userNum}\n`;
    if (numAnim > 0) {
      texto += `   🎬 ${numAnim} animación${numAnim !== 1 ? "es" : ""} guardada${numAnim !== 1 ? "s" : ""}\n`;
    } else {
      texto += `   💤 Sin animar aún\n`;
    }
    texto += `\n`;
  }

  texto += `━━━━━━━━━━━━━━━━━━━━\n`;
  texto += `📊 *Total:* ${total} sticker${total !== 1 ? "s" : ""}\n\n`;
  texto += `🎬 Animar: *${pref}anim <palabra>*\n`;
  texto += `📤 Enviar: *${pref}sk <palabra>*`;

  return conn.sendMessage(chatId, {
    text: texto,
    mentions,
  }, { quoted: msg });
};

handler.command = ["versk"];
handler.help = ["versk"];
handler.tags = ["stickers"];
module.exports = handler;
