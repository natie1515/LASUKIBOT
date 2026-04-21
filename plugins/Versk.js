// plugins/versk.js
// Muestra la lista de imágenes guardadas con .guarsk y sus stickers .was generados
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

function listAnimationsOfKey(safeKey) {
  if (!fs.existsSync(ANIM_DIR)) return [];
  try {
    const files = fs.readdirSync(ANIM_DIR);
    return files
      .filter(f => f.startsWith(`${safeKey}_`) && f.endsWith(".was"))
      .map(f => f.replace(`${safeKey}_`, "").replace(".was", ""));
  } catch {
    return [];
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
`╭━━━━━━━━━━━━━━━━━━━━╮
   📋 𝗦𝗧𝗜𝗖𝗞𝗘𝗥𝗦 𝗚𝗨𝗔𝗥𝗗𝗔𝗗𝗢𝗦
╰━━━━━━━━━━━━━━━━━━━━╯

📂 *No hay imágenes guardadas aún.*

Guarda una con:
*${pref}guarsk <palabra>* (respondiendo a una imagen)`,
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
  let totalWAS = 0;

  for (const safeKey of validKeys) {
    const entry = db[safeKey];
    total++;
    const efectos = listAnimationsOfKey(safeKey);
    totalWAS += efectos.length;

    const userNum = entry.savedBy ? String(entry.savedBy).replace(/\D/g, "") : null;
    const userJid = userNum ? `${userNum}@s.whatsapp.net` : null;
    if (userJid && !mentions.includes(userJid)) mentions.push(userJid);

    texto += `🗝️ *${entry.key || safeKey}*\n`;
    if (userNum) texto += `   👤 Guardó: @${userNum}\n`;
    if (efectos.length > 0) {
      texto += `   🎬 Efectos (.was): ${efectos.map(e => `*${e}*`).join(", ")}\n`;
    } else {
      texto += `   💤 Sin sticker .was aún\n`;
    }
    texto += `\n`;
  }

  texto += `━━━━━━━━━━━━━━━━━━━━\n`;
  texto += `📊 *Total:* ${total} imagen${total !== 1 ? "es" : ""} · ${totalWAS} sticker${totalWAS !== 1 ? "s" : ""} .was\n\n`;
  texto += `💾 Guardar: *${pref}guarsk <palabra>*\n`;
  texto += `🎬 Animar: *${pref}anim <palabra>* (respondiendo .was)\n`;
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
