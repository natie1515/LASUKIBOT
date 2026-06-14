import fs from 'fs';

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const filePath = "./ventas365.json";

  const data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : {};
  const peliculas = data[chatId]?.setpeliculas;

  if (!peliculas) {
    return conn.sendMessage(chatId, {
      text: "🎬 No hay películas configuradas para este grupo.",
    }, { quoted: msg });
  }

  if (peliculas.imagen) {
    const buffer = Buffer.from(peliculas.imagen, "base64");
    await conn.sendMessage(chatId, {
      image: buffer,
      caption: peliculas.texto
    }, { quoted: msg });
  } else {
    await conn.sendMessage(chatId, {
      text: peliculas.texto
    }, { quoted: msg });
  }
};

handler.command = ["peliculas"];
export default handler;
