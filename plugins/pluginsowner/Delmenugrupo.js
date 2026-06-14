// plugins/delmenugrupo.js
import fs from 'fs';
import path from 'path';

const DIGITS = (s = "") => String(s).replace(/\D/g, "");

const handler = async (msg, { conn }) => {
  const chatId    = msg.key.remoteJid;
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderNum = DIGITS(senderJid);
  const fromMe    = !!msg.key.fromMe;

  const isOwner = (typeof global.isOwner === "function")
    ? global.isOwner(senderNum)
    : (Array.isArray(global.owner) && global.owner.some(([id]) => id === senderNum));

  if (!isOwner && !fromMe) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: "🚫 *Solo un Owner o el bot pueden eliminar el C-Menu Grupo (global).*"
    }, { quoted: msg });
  }

  const filePath = path.resolve("./setmenu.json");
  if (!fs.existsSync(filePath)) {
    return conn.sendMessage(chatId, { text: "ℹ️ *No hay C-Menu Grupo guardado.*" }, { quoted: msg });
  }

  let data = {};
  try { data = JSON.parse(fs.readFileSync(filePath, "utf-8")); }
  catch { data = {}; }

  const hadAny = !!(data.texto_grupo || data.imagen_grupo);

  delete data.texto_grupo;
  delete data.imagen_grupo;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  return conn.sendMessage(
    chatId,
    { text: hadAny ? "✅ *C-Menu Grupo eliminado (global).*" : "ℹ️ *No había C-Menu Grupo guardado.*" },
    { quoted: msg }
  );
};

handler.command = ["delmenugrupo", "delmenug"];
handler.help = ["delmenugrupo", "delmenug"];
handler.tags = ["menu"];
export default handler;
