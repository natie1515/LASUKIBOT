import { setConfig } from '../../db.js';
import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderId = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isOwner = global.isOwner(senderId);
  const fromMe = msg.key.fromMe;

  if (!isOwner && !fromMe) {
    return conn.sendMessage(chatId, {
      text: "⛔ Solo *dueños del bot* o el *bot* mismo pueden usar este comando."
    }, { quoted: msg });
  }

  const estado = args[0]?.toLowerCase();
  if (!["on", "off"].includes(estado)) {
    return conn.sendMessage(chatId, {
      text: "🎛️ *Usa:* `.modoprivado on` o `.modoprivado off`"
    }, { quoted: msg });
    return;
  }

  const valor = estado === "on" ? 1 : 0;
  await setConfig("global", "modoprivado", valor);

  await conn.sendMessage(chatId, {
    text: `🔐 *Modo Privado* ha sido ${estado === "on" ? "🔛 *activado*" : "🔴 *desactivado*"} correctamente.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: estado === "on" ? "🔐" : "🚫", key: msg.key }
  });
};

handler.command = ["modoprivado"];
export default handler;
