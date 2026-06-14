import fs from 'fs';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const filePath = "./ventas365.json";

  if (!fs.existsSync(filePath)) {
    return conn.sendMessage(chatId, {
      text: "❌ No hay datos guardados aún."
    }, { quoted: msg });
  }

  const ventas = JSON.parse(fs.readFileSync(filePath));
  const data = ventas[chatId]?.setsoporte;

  if (!data || (!data.texto && !data.imagen)) {
    return conn.sendMessage(chatId, {
      text: "❌ No hay información de soporte guardada con setsoporte."
    }, { quoted: msg });
  }

  if (data.imagen) {
    const buffer = Buffer.from(data.imagen, "base64");
    await conn.sendMessage(chatId, {
      image: buffer,
      caption: data.texto || "📞 Información de soporte"
    }, { quoted: msg });
  } else {
    await conn.sendMessage(chatId, {
      text: data.texto
    }, { quoted: msg });
  }
};

handler.command = ["soporte"];
export default handler;
