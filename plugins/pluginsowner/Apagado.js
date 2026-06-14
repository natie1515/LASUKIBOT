import { setConfig } from '../../db.js';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderId = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isOwner = global.owner.some(([id]) => id === senderNum);

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo funciona en grupos."
    }, { quoted: msg });
  }

  if (!isOwner) {
    return conn.sendMessage(chatId, {
      text: "⛔ Solo el *dueño del bot* puede usar este comando en grupos."
    }, { quoted: msg });
  }

  const estado = args[0]?.toLowerCase();
  if (!["on", "off"].includes(estado)) {
    return conn.sendMessage(chatId, {
      text: "🎛️ *Usa:* `.apagado on` o `.apagado off`"
    }, { quoted: msg });
  }

  const nuevoEstado = estado === "on" ? 1 : 0;
  await setConfig(chatId, "apagado", nuevoEstado);

  await conn.sendMessage(chatId, {
    text: `✨️ El bot ha sido *${estado === "on" ? "apagado" : "encendido"}* en este grupo.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: estado === "on" ? "🔌" : "⚡", key: msg.key }
  });
};

handler.command = ["apagado"];
export default handler;
