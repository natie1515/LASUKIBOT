import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");
  const isFromMe = msg.key.fromMe;

  // Verificar si es owner
  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath)) : [];
  const isOwner = owners.some(([id]) => id === senderId);

  if (!isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ *Solo los dueños del bot pueden cambiar el nombre.*"
    }, { quoted: msg });
    return;
  }

  const newName = args.join(" ").trim();

  if (!newName) {
    await conn.sendMessage(chatId, {
      text: "📛 *Debes escribir el nuevo nombre que deseas para el bot.*\n\nEjemplo:\n.botname Suki Bot"
    }, { quoted: msg });
    return;
  }

  try {
    await conn.updateProfileStatus(newName);
    await conn.updateProfileName(newName);

    await conn.sendMessage(chatId, {
      text: `✅ *Nombre del bot actualizado exitosamente a:* ${newName}`
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "✨", key: msg.key }
    });
  } catch (error) {
    console.error("❌ Error al cambiar nombre del bot:", error);
    await conn.sendMessage(chatId, {
      text: "❌ *Hubo un error al actualizar el nombre del bot.*"
    }, { quoted: msg });
  }
};

handler.command = ["botname"];
export default handler;
