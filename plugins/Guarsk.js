// plugins/guarsk.js
// Guarda una imagen con una palabra clave.
// Esta imagen se usará después para reemplazar la imagen interna de stickers .was
//
// Uso: .guarsk <palabra_clave>  (respondiendo a una imagen)
// Ej:  .guarsk hola
//      .guarsk cara feliz

"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");

const IMAGES_DIR = path.resolve("./sticker_base");
const DB_FILE = path.resolve("./sticker_base.json");
const TMP_DIR = path.resolve("./tmp");

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

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
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } catch { return {}; }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("[guarsk] error guardando DB:", e);
  }
}

function randomName(ext) {
  return `${Crypto.randomBytes(6).toString("hex")}.${ext}`;
}

// 🖼️ Normaliza la imagen a PNG 540x540 (tamaño ideal para Lottie)
async function normalizeImage(buffer, ext = "jpg") {
  const tmpIn = path.join(TMP_DIR, randomName(ext));
  const tmpOut = path.join(TMP_DIR, randomName("png"));
  fs.writeFileSync(tmpIn, buffer);

  return new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .outputOptions([
        "-vf", "scale=540:540:force_original_aspect_ratio=decrease,pad=540:540:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      ])
      .on("error", (err) => {
        try { fs.unlinkSync(tmpIn); } catch {}
        reject(err);
      })
      .on("end", () => {
        try {
          const buf = fs.readFileSync(tmpOut);
          fs.unlinkSync(tmpIn);
          fs.unlinkSync(tmpOut);
          resolve(buf);
        } catch (e) { reject(e); }
      })
      .save(tmpOut);
  });
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
*${pref}guarsk <palabra clave>* (respondiendo a una imagen)

Ejemplos:
• ${pref}guarsk hola
• ${pref}guarsk cara feliz
• ${pref}guarsk logo`,
    }, { quoted: msg });
  }

  const safeKey = sanitizeKey(keyword);
  if (!safeKey) {
    return conn.sendMessage(chatId, {
      text: `❌ Palabra clave inválida.`,
    }, { quoted: msg });
  }

  // 🎯 Verificar que haya imagen citada
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.imageMessage) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Debes responder a una imagen.*

✳️ Uso:
*${pref}guarsk <palabra clave>* (respondiendo a una imagen)`,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "💾", key: msg.key } });

  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys.");

    // Descargar imagen
    const stream = await WA.downloadContentFromMessage(quoted.imageMessage, "image");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    if (!buffer.length) throw new Error("La imagen está vacía.");

    // Normalizar a PNG 540x540
    const pngBuffer = await normalizeImage(buffer, "jpg");
    if (!pngBuffer || !pngBuffer.length) throw new Error("No se pudo procesar la imagen.");

    // Guardar
    const fileName = `${safeKey}.png`;
    const filePath = path.join(IMAGES_DIR, fileName);
    fs.writeFileSync(filePath, pngBuffer);

    // Actualizar DB
    const db = loadDB();
    const alreadyExists = !!db[safeKey];
    db[safeKey] = {
      key: keyword,
      safeKey,
      path: filePath,
      savedBy: senderId,
      savedAt: new Date().toISOString(),
      size: pngBuffer.length,
    };
    saveDB(db);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    return conn.sendMessage(chatId, {
      text:
`╭━━━━━━━━━━━━━━━━━━━━╮
   💾 𝗜𝗠𝗔𝗚𝗘𝗡 𝗚𝗨𝗔𝗥𝗗𝗔𝗗𝗔
╰━━━━━━━━━━━━━━━━━━━━╯

🗝️ *Palabra clave:* ${keyword}
📂 *Archivo:* ${fileName}
💾 *Tamaño:* ${(pngBuffer.length / 1024).toFixed(2)} KB
${alreadyExists ? "♻️ Reemplazó la imagen anterior." : "🆕 Nueva imagen guardada."}

━━━━━━━━━━━━━━━━━━━━
💡 *Cómo usar:*
Responde a un sticker .was con:
*${pref}anim ${keyword}*

Y tu imagen se meterá dentro de esa animación.
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
