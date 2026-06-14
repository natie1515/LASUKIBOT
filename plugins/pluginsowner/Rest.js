import fs from 'fs';
import path from 'path';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const senderId = (msg.key.participant || msg.key.remoteJid).replace(/[^0-9]/g, "");
  const isFromMe = msg.key.fromMe;

  const ownerPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownerPath) ? JSON.parse(fs.readFileSync(ownerPath)) : [];
  const isOwner = owners.some(([id]) => id === senderId);

  if (!isOwner && !isFromMe) {
    await conn.sendMessage(chatId, {
      text: "⛔ Este comando es solo para el *Owner*."
    }, { quoted: msg });
    return;
  }

  // Reacción 🔄
  await conn.sendMessage(chatId, {
    react: { text: "🔄", key: msg.key }
  });

  // Mensaje de aviso
  await conn.sendMessage(chatId, {
    text: "🔄 *Suki Bot se reiniciará en unos segundos...*"
  }, { quoted: msg });

  // Guardar chat para notificar luego
  const restartPath = path.resolve("lastRestarter.json");
  fs.writeFileSync(restartPath, JSON.stringify({ chatId }, null, 2));

  setTimeout(() => process.exit(1), 3000);
};

handler.command = ["rest"];
export default handler;
