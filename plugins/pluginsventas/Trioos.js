"use strict";

import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve("./ventas365.json");

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  if (!fs.existsSync(DB_PATH)) {
    return conn.sendMessage(chatId, { text: "❌ No hay datos guardados aún." }, { quoted: msg });
  }

  let db = {};
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch (e) {
    console.error("[trios] JSON corrupto:", e);
    return conn.sendMessage(chatId, { text: "❌ Los datos están corruptos. Vuelve a guardar con *settrios*." }, { quoted: msg });
  }

  const data = db[chatId]?.settrios;
  if (!data || (!data.texto && !data.imagen)) {
    return conn.sendMessage(chatId, { text: "❌ No hay contenido guardado con settrios en este grupo." }, { quoted: msg });
  }

  if (data.imagen) {
    try {
      const buffer = Buffer.from(data.imagen, "base64");
      await conn.sendMessage(chatId, { image: buffer, caption: data.texto || "🎯 Trios" }, { quoted: msg });
    } catch (e) {
      console.error("[trios] enviar imagen:", e);
      await conn.sendMessage(chatId, { text: data.texto || "🎯 Trios" }, { quoted: msg });
    }
  } else {
    await conn.sendMessage(chatId, { text: data.texto }, { quoted: msg });
  }
};

handler.command = ["trios"];
export default handler;
