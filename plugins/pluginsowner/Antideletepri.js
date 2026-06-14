import { setConfig } from '../../db.js';
import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");
  const isFromMe = msg.key.fromMe;

  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath)) : [];
  const isOwner = owners.some(([id]) => id === senderId);

  if (!isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ *Solo los dueños del bot pueden usar este comando.*"
    }, { quoted: msg });
    return;
  }

  const estado = args[0]?.toLowerCase();
  if (!["on", "off"].includes(estado)) {
    await conn.sendMessage(chatId, {
      text: "🎛️ *Usa:* `.antideletepri on` o `.antideletepri off`"
    }, { quoted: msg });
    return;
  }

  const nuevoEstado = estado === "on" ? 1 : 0;
  await setConfig("global", "antideletepri", nuevoEstado);

  await conn.sendMessage(chatId, {
    text: `✅ *Antidelete privado* ha sido ${estado === "on" ? "*activado*" : "*desactivado*"} en todos los chats privados.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: estado === "on" ? "🛡️" : "❌", key: msg.key }
  });
};

handler.command = ["antideletepri"];
export default handler;
