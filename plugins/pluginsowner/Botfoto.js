// plugins/botfoto.js — ESM-safe + wa.download
import fs from 'fs';
import path from 'path';

// Desencapsula view-once / efímeros
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
function getQuotedMessage(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const ctx =
    root?.extendedTextMessage?.contextInfo ||
    root?.imageMessage?.contextInfo ||
    root?.videoMessage?.contextInfo ||
    root?.documentMessage?.contextInfo ||
    root?.audioMessage?.contextInfo ||
    root?.stickerMessage?.contextInfo ||
    null;
  return ctx?.quotedMessage ? unwrapMessage(ctx.quotedMessage) : null;
}
async function getDownloader(wa) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa.downloadContentFromMessage;
  try {
    const m = await import("@whiskeysockets/baileys");
    return m.downloadContentFromMessage;
  } catch {
    return null;
  }
}

const handler = async (msg, { conn, wa }) => {
  const chatId   = msg.key.remoteJid;
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/\D/g, "");
  const isFromMe = !!msg.key.fromMe;

  // Permiso: owner o el propio bot
  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath, "utf-8")) : [];
  const isOwner = Array.isArray(owners) && owners.some(([id]) => id === senderId);
  if (!isOwner && !isFromMe) {
    await conn.sendMessage(chatId, { text: "⛔ *Solo los dueños del bot pueden cambiar la foto de perfil.*" }, { quoted: msg });
    return;
  }

  const quoted = getQuotedMessage(msg);
  const imageNode = quoted?.imageMessage;
  if (!imageNode) {
    await conn.sendMessage(chatId, { text: "⚠️ *Responde a una imagen* para cambiar la foto del bot." }, { quoted: msg });
    return;
  }

  const DL = await getDownloader(wa);
  if (!DL) {
    await conn.sendMessage(chatId, { text: "❌ Falta `wa.downloadContentFromMessage`." }, { quoted: msg });
    return;
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "🖼️", key: msg.key } });

    const stream = await DL(imageNode, "image");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    const botJid = (conn.user?.id || "").replace(/:\d+/, ""); // normaliza 123@s.whatsapp.net
    await conn.updateProfilePicture(botJid, buffer);

    await conn.sendMessage(chatId, { text: "✅ *Foto de perfil del bot actualizada correctamente.*" }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    console.error("❌ Error al cambiar foto:", err);
    await conn.sendMessage(chatId, { text: `❌ *Ocurrió un error al cambiar la foto.*` }, { quoted: msg });
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
  }
};

handler.command = ["botfoto"];
export default handler;
