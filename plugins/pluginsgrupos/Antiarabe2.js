import { setConfig } from '../../db.js';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderId = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isOwner = global.owner.some(([id]) => id === senderNum);

  console.log("📦 Comando antiarabe2 ejecutado en:", chatId, "por:", senderNum);

  if (!chatId.endsWith("@g.us")) {
    return conn.sendMessage(chatId, {
      text: "❌ Este comando solo puede usarse en *grupos*.",
    }, { quoted: msg });
  }

  // ✅ Verificar si es admin del grupo
  let isAdmin = false;
  try {
    const metadata = await conn.groupMetadata(chatId);
    const participant = metadata.participants.find(p => p.id === senderId);
    isAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
  } catch (e) {
    console.error("❌ Error obteniendo metadata del grupo:", e);
  }

  if (!isOwner && !isAdmin) {
    return conn.sendMessage(chatId, {
      text: "⛔ Solo el *dueño del bot* o un *administrador del grupo* puede usar este comando.",
    }, { quoted: msg });
  }

  const estado = args[0]?.toLowerCase();
  if (!["on", "off"].includes(estado)) {
    return conn.sendMessage(chatId, {
      text: "🛡️ *Usa:* `.antiarabe2 on` o `.antiarabe2 off`",
    }, { quoted: msg });
  }

  const nuevoEstado = estado === "on" ? 1 : 0;
  console.log("📝 Guardando antiarabe2 =", nuevoEstado, "para", chatId);
  await setConfig(chatId, "antiarabe2", nuevoEstado);

  await conn.sendMessage(chatId, {
    text: `🚫 El sistema *anti árabe 2* ha sido *${estado === "on" ? "activado" : "desactivado"}* en este grupo.`,
    quoted: msg
  });

  await conn.sendMessage(chatId, {
    react: { text: estado === "on" ? "🧕" : "🟢", key: msg.key }
  });
};

handler.command = ["antiarabe2"];
export default handler;
