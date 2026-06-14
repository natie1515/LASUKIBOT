"use strict";

import fs from 'fs';
import path from 'path';
const DB_PATH = path.resolve("./ventas365.json");

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  if (!fs.existsSync(DB_PATH))
    return conn.sendMessage(chatId, { text: "❌ No hay datos guardados aún." }, { quoted: msg });

  let db = {};
  try { db = JSON.parse(fs.readFileSync(DB_PATH, "utf-8")); }
  catch { return conn.sendMessage(chatId, { text: "❌ Datos corruptos. Guarda de nuevo con *setstock2*." }, { quoted: msg }); }

  const data = db[chatId]?.setstock2;
  if (!data || (!data.texto && !data.imagen))
    return conn.sendMessage(chatId, { text: "❌ No hay contenido guardado con setstock2 en este grupo." }, { quoted: msg });

  if (data.imagen) {
    try {
      const buf = Buffer.from(data.imagen, "base64");
      await conn.sendMessage(chatId, { image: buf, caption: data.texto || "📦 Stock 2" }, { quoted: msg });
    } catch {
      await conn.sendMessage(chatId, { text: data.texto || "📦 Stock 2" }, { quoted: msg });
    }
  } else {
    await conn.sendMessage(chatId, { text: data.texto }, { quoted: msg });
  }
};

handler.command = ["stock2"];
export default handler;
