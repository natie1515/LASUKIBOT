// comandos/ytmp3.js — YouTube MP3 (URL)
// ✅ Usa la API de resolve de play.js
// ✅ Botones Nativos + Reacciones + Respuestas
// ✅ Envío de archivo optimizado sin bloquear RAM
// ✅ Respeta activoss.json

"use strict";

const axios = require("axios");
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const MAX_MB = 200;
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingYTA = Object.create(null);

function ensureTmp() {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function safeBaseFromTitle(title) {
  return String(title || "audio")
    .slice(0, 70)
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function fileSizeMB(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.statSync(filePath).size / (1024 * 1024);
}

function botonesActivos() {
  if (typeof global.configBotones !== "undefined") return global.configBotones;
  if (!fs.existsSync(ACTIVOSS_FILE)) return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(ACTIVOSS_FILE, "utf-8"));
    return cfg.botones !== false;
  } catch {
    return true;
  }
}

function isYouTube(u = "") {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(String(u));
}

async function downloadToFile(url, filePath) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    Accept: "*/*",
  };
  if (url.includes(new URL(API_BASE).host)) headers["apikey"] = API_KEY;

  const res = await axios.get(url, { responseType: "stream", timeout: 180000, headers, maxRedirects: 5, validateStatus: () => true });
  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);
  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

async function callYoutubeResolve(videoUrl, { type, format }) {
  const endpoint = `${API_BASE}/youtube/resolve`;
  const r = await axios.post(
    endpoint,
    { url: videoUrl, type, format: format || "mp3" },
    { headers: { "Content-Type": "application/json", apikey: API_KEY, Accept: "application/json, */*" }, validateStatus: () => true }
  );

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");
  if (!data.status && !data.ok && !data.success) throw new Error(data.message || data.error || "Error en la API");
  
  const result = data.result || data.data || data;
  if (!result?.media) throw new Error("API sin media");

  let dl = result.media.dl_download || result.media.direct || "";
  if (dl && dl.startsWith("/")) dl = API_BASE + dl;

  return { title: result.title || "YouTube", thumbnail: result.thumbnail || "", mediaUrl: dl };
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  let url = (args[0] || "").trim();

  if (!url) {
    return conn.sendMessage(chatId, { text: `✳️ Usa:\n${pref}${command} <URL YouTube>\nEj: ${pref}${command} https://youtu.be/dQw4w9WgXcQ` }, { quoted: msg });
  }

  if (!isYouTube(url)) {
    return conn.sendMessage(chatId, { text: `❌ Enlace inválido. Usa URL de YouTube.` }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    // Buscar info rápido con yts para el menú
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    const videoId = videoIdMatch ? videoIdMatch[1] : url;
    let title = "YouTube Audio", thumbnail = "";
    
    try {
      const searchRes = await yts({ videoId });
      if (searchRes) {
        title = searchRes.title;
        thumbnail = searchRes.thumbnail;
      }
    } catch {}

    const usarBotones = botonesActivos();
    const caption = usarBotones
      ? `⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗠𝗣𝟯\n\n🎵 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}\n\n👇 *Toca el botón abajo para descargar*`
      : `⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗠𝗣𝟯\n\n🎵 𝗧𝗶́𝘁𝘂𝗹𝗼: ${title}\n\nElige cómo enviarlo:\n👍 𝗔𝘂𝗱𝗶𝗼 (normal)\n❤️ 𝗔𝘂𝗱𝗶𝗼 𝗰𝗼𝗺𝗼 𝗱𝗼𝗰𝘂𝗺𝗲𝗻𝘁𝗼\n\n— o responde: *1* (audio) · *2* (documento)`;

    const btns = [{
      text: "📥 Menú de descarga",
      sections: [{
        title: "🎵 OPCIONES DE AUDIO",
        rows: [
          { title: "🎵 Audio MP3", description: "Descargar como nota de audio", id: `${pref}ytmp3_audio` },
          { title: "📄 Audio Documento", description: "Descargar como archivo MP3", id: `${pref}ytmp3_doc` },
        ]
      }]
    }];

    let preview;
    const msgPayload = { caption, footer: "🤖 La Suki Bot" };
    if (thumbnail) msgPayload.image = { url: thumbnail };
    if (usarBotones) {
      msgPayload.buttons = btns;
      msgPayload.headerType = thumbnail ? 4 : 1;
    }

    preview = await conn.sendMessage(chatId, msgPayload, { quoted: msg });

    pendingYTA[preview.key.id] = { chatId, url, title, thumbnail, quotedBase: msg, isBusy: false };
    setTimeout(() => { delete pendingYTA[preview.key.id]; }, 10 * 60 * 1000);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    if (!conn._ytmp3Listener) {
      conn._ytmp3Listener = true;
      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          // Reacciones
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = pendingYTA[reactKey.id];
            if (job && (emoji === "👍" || emoji === "❤️")) {
              await sendMp3(conn, job, emoji === "❤️", m);
            }
            continue;
          }
          // Botones interactivos
          const interactiveReply = m.message?.interactiveResponseMessage?.nativeFlowResponseMessage || m.message?.listResponseMessage || m.message?.templateButtonReplyMessage;
          if (interactiveReply) {
            let selectedId = "";
            try {
              if (interactiveReply.paramsJson) selectedId = JSON.parse(interactiveReply.paramsJson).id;
              else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
            } catch {}

            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            const job = pendingYTA[ctxQuoted];
            if (job && selectedId) {
              if (selectedId.endsWith("ytmp3_audio")) await sendMp3(conn, job, false, m);
              if (selectedId.endsWith("ytmp3_doc")) await sendMp3(conn, job, true, m);
            }
            continue;
          }
          // Respuestas de texto
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          if (ctx?.stanzaId && pendingYTA[ctx.stanzaId]) {
            const txt = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
            if (txt === "1" || txt === "2") {
              await sendMp3(conn, pendingYTA[ctx.stanzaId], txt === "2", m);
            }
          }
        }
      });
    }
  } catch (err) {
    await conn.sendMessage(chatId, { text: `❌ *Error:* ${err?.message}` }, { quoted: msg });
  }
};

async function sendMp3(conn, job, asDocument, triggerMsg) {
  if (job.isBusy) return;
  job.isBusy = true;
  
  const tmp = ensureTmp();
  const base = safeBaseFromTitle(job.title);
  const inFile = path.join(tmp, `${Date.now()}_in.bin`);
  const outFile = path.join(tmp, `${Date.now()}_${base}.mp3`);
  
  try {
    await conn.sendMessage(job.chatId, { react: { text: asDocument ? "📄" : "🎵", key: triggerMsg.key } });
    await conn.sendMessage(job.chatId, { text: "⏳ Espere, descargando su canción..." }, { quoted: triggerMsg });

    const resolved = await callYoutubeResolve(job.url, { type: "audio" });
    if (!resolved.mediaUrl) throw new Error("No se pudo obtener el audio.");

    await downloadToFile(resolved.mediaUrl, inFile);

    await new Promise((resolve, reject) => {
      ffmpeg(inFile).audioCodec("libmp3lame").audioBitrate("128k").format("mp3").save(outFile)
        .on("end", resolve).on("error", reject);
    });

    const sizeMB = fileSizeMB(outFile);
    if (sizeMB > MAX_MB) throw new Error(`El audio supera el límite de ${MAX_MB}MB.`);

    const caption = `🎵 𝗧𝗶́𝘁𝘂𝗹𝗼: ${resolved.title}\n💾 𝗣𝗲𝘀𝗼: ${sizeMB.toFixed(2)} MB\n🤖 𝗕𝗼𝘁: La Suki Bot`;

    await conn.sendMessage(job.chatId, {
      [asDocument ? "document" : "audio"]: { url: outFile },
      mimetype: "audio/mpeg",
      fileName: `${base}.mp3`,
      caption: asDocument ? caption : undefined
    }, { quoted: job.quotedBase });

    if (!asDocument) {
      await conn.sendMessage(job.chatId, { text: caption }, { quoted: job.quotedBase });
    }

    await conn.sendMessage(job.chatId, { react: { text: "✅", key: triggerMsg.key } });
  } catch (e) {
    await conn.sendMessage(job.chatId, { text: `❌ Error: ${e.message}` }, { quoted: job.quotedBase });
  } finally {
    try { fs.unlinkSync(inFile); } catch {}
    try { fs.unlinkSync(outFile); } catch {}
    job.isBusy = false;
  }
}

module.exports.command = ["ytmp3", "yta"];
module.exports.help = ["ytmp3 <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
