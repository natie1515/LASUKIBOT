// comandos/ytmp3.js — YouTube MP3 (URL)
// ✅ API original que SÍ funciona (POST /youtube/resolve, type: audio)
// ✅ 2 Botones rápidos (Audio Normal y Documento)
// ✅ Respeta activoss.json
// ✅ Sistema de bloqueo isBusy con aviso al usuario

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

const pendingYTA = {};

// ---------- utils ----------
function safeName(name = "audio") {
  return String(name).slice(0, 90).replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim() || "audio";
}

function fileSizeMB(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.statSync(filePath).size / (1024 * 1024);
}

function ensureTmp() {
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function botonesActivos() {
  if (!fs.existsSync(ACTIVOSS_FILE)) return true;
  try { return JSON.parse(fs.readFileSync(ACTIVOSS_FILE, "utf-8")).botones !== false; }
  catch { return true; }
}

function isYouTube(u = "") {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\//i.test(String(u));
}

async function downloadToFile(url, filePath) {
  const headers = { "User-Agent": "Mozilla/5.0", Accept: "*/*" };
  if (url.includes(new URL(API_BASE).host)) headers["apikey"] = API_KEY;
  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 180000,
    headers,
    maxRedirects: 5,
    validateStatus: () => true
  });
  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);
  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

async function callYoutubeResolve(videoUrl) {
  const r = await axios.post(`${API_BASE}/youtube/resolve`,
    { url: videoUrl, type: "audio", format: "mp3" },
    { headers: { "Content-Type": "application/json", apikey: API_KEY }, validateStatus: () => true }
  );
  const data = typeof r.data === "object" ? r.data : null;
  if (!data || (!data.status && !data.ok && !data.success)) {
    throw new Error(data?.message || data?.error || "Error en la API");
  }
  const result = data.result || data.data || data;
  let dl = result.media?.dl_download
    || result.media?.direct
    || result.media?.url
    || result.url
    || result.download
    || "";
  if (dl && dl.startsWith("/")) dl = API_BASE + dl;
  return {
    title: result.title || "YouTube Audio",
    author: (typeof result.author === "object" ? result.author?.name : result.author) || "Desconocido",
    duration: result.duration || result.timestamp || 0,
    mediaUrl: dl
  };
}

// ---------- main ----------
module.exports = async (msg, { conn, args, command }) => {
  const pref = global.prefixes?.[0] || ".";
  let url = (args[0] || "").trim();

  if (!url) return conn.sendMessage(msg.key.remoteJid, { text: `✳️ Usa:\n${pref}${command} <URL>` }, { quoted: msg });
  if (!isYouTube(url)) return conn.sendMessage(msg.key.remoteJid, { text: `❌ Enlace inválido.` }, { quoted: msg });

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

  let title = "YouTube Audio", thumbnail = "", durationTxt = "—", author = "Desconocido";
  try {
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    if (videoIdMatch) {
      const searchRes = await yts({ videoId: videoIdMatch[1] });
      if (searchRes) {
        title = searchRes.title;
        thumbnail = searchRes.thumbnail;
        durationTxt = searchRes.timestamp;
        author = searchRes.author?.name || "Desconocido";
      }
    }
  } catch {}

  const usarBotones = botonesActivos();

  const caption = usarBotones ?
`╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗠𝗣𝟯 ⚡
╰━━━━━━━━━━━━━━━━╯

🎵 *Título:* ${title}
👤 *Canal:* ${author}
⏱️ *Duración:* ${durationTxt}

👇 *Elige una opción abajo:*`
  :
`╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗠𝗣𝟯 ⚡
╰━━━━━━━━━━━━━━━━╯

🎵 *Título:* ${title}
👤 *Canal:* ${author}
⏱️ *Duración:* ${durationTxt}

🟡 *OPCIÓN 1 — Reaccionar*
   👍  →  Audio Normal
   📄  →  Audio como Documento

🔵 *OPCIÓN 2 — Responder citando este mensaje*
   *1* →  Audio Normal
   *2* →  Audio como Documento`;

  // 2 Botones rápidos (quick_reply)
  const nativeFlowButtons = [
    { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🎵 Audio Normal", id: `${pref}ytmp3_audio` }) },
    { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "📄 Documento",    id: `${pref}ytmp3_audiodoc` }) }
  ];

  let preview;
  if (usarBotones) {
    try {
      const payload = { caption, footer: "🤖 La Suki Bot", buttons: nativeFlowButtons, headerType: 1 };
      if (thumbnail) { payload.image = { url: thumbnail }; payload.headerType = 4; }
      preview = await conn.sendMessage(msg.key.remoteJid, payload, { quoted: msg });
    } catch (e) {
      preview = await conn.sendMessage(msg.key.remoteJid,
        thumbnail ? { image: { url: thumbnail }, caption } : { text: caption },
        { quoted: msg });
    }
  } else {
    preview = await conn.sendMessage(msg.key.remoteJid,
      thumbnail ? { image: { url: thumbnail }, caption } : { text: caption },
      { quoted: msg });
  }

  pendingYTA[preview.key.id] = {
    chatId: msg.key.remoteJid, url, title, thumbnail, author, durationTxt,
    commandMsg: msg, isBusy: false, _createdAt: Date.now()
  };
  setTimeout(() => { delete pendingYTA[preview.key.id]; }, 10 * 60 * 1000);

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

  // ====== Listener único ======
  if (!conn._ytmp3Listener) {
    conn._ytmp3Listener = true;
    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {

        // 1) REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pendingYTA[reactKey.id];
          if (job) {
            if (emoji === "👍") await downloadAudio(conn, job, false, m);
            if (emoji === "📄" || emoji === "❤️") await downloadAudio(conn, job, true, m);
          }
          continue;
        }

        // 2) BOTONES INTERACTIVOS
        try {
          const interactiveReply =
               m.message?.interactiveResponseMessage?.nativeFlowResponseMessage
            || m.message?.listResponseMessage
            || m.message?.buttonsResponseMessage
            || m.message?.templateButtonReplyMessage
            || null;

          if (interactiveReply) {
            let selectedId = "";
            if (interactiveReply?.paramsJson) {
              try { selectedId = JSON.parse(interactiveReply.paramsJson).id || ""; } catch {}
            } else if (m.message?.buttonsResponseMessage?.selectedButtonId) {
              selectedId = m.message.buttonsResponseMessage.selectedButtonId;
            } else if (m.message?.templateButtonReplyMessage?.selectedId) {
              selectedId = m.message.templateButtonReplyMessage.selectedId;
            }

            if (!selectedId) continue;
            // Solo IDs propios de ytmp3 (evita conflicto con ytmp4)
            if (!selectedId.includes("ytmp3_")) continue;

            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;
            if (ctxQuoted && pendingYTA[ctxQuoted]) {
              job = pendingYTA[ctxQuoted];
            } else {
              const jobsInChat = Object.entries(pendingYTA)
                .filter(([, j]) => j.chatId === m.key.remoteJid)
                .sort(([, a], [, b]) => (b._createdAt || 0) - (a._createdAt || 0));
              if (jobsInChat.length > 0) job = jobsInChat[0][1];
            }

            if (!job) continue;

            if (selectedId.endsWith("ytmp3_audio")) await downloadAudio(conn, job, false, m);
            else if (selectedId.endsWith("ytmp3_audiodoc")) await downloadAudio(conn, job, true, m);
            continue;
          }
        } catch (e) {}

        // 3) RESPUESTAS CITADAS
        try {
          const citado = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          const texto = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
          const job = pendingYTA[citado];
          if (citado && job) {
            if (texto === "1" || texto === "audio") await downloadAudio(conn, job, false, m);
            else if (texto === "2" || texto === "documento" || texto === "doc") await downloadAudio(conn, job, true, m);
          }
        } catch (e) {}
      }
    });
  }
};

async function downloadAudio(conn, job, asDocument, m) {
  if (job.isBusy) {
    try {
      await conn.sendMessage(job.chatId, {
        text: "⌛ Ya estoy procesando este audio, espere a que termine la descarga actual..."
      }, { quoted: m });
    } catch {}
    return;
  }
  job.isBusy = true;

  const tmp = ensureTmp();
  const inFile = path.join(tmp, `${Date.now()}_in.bin`);
  const outFile = path.join(tmp, `${Date.now()}_out.mp3`);

  try {
    await conn.sendMessage(job.chatId, { react: { text: asDocument ? "📄" : "🎵", key: m.key } });
    await conn.sendMessage(job.chatId, { text: "⏳ Espere, descargando su canción..." }, { quoted: m });

    const res = await callYoutubeResolve(job.url);
    if (!res.mediaUrl) throw new Error("No se pudo obtener audio.");

    await downloadToFile(res.mediaUrl, inFile);

    await new Promise((resolve, reject) => {
      ffmpeg(inFile).audioCodec("libmp3lame").audioBitrate("128k").format("mp3").save(outFile)
        .on("end", resolve).on("error", reject);
    });

    const sizeMB = fileSizeMB(outFile);
    if (sizeMB > MAX_MB) throw new Error(`Audio supera los ${MAX_MB}MB.`);

    const finalTitle = res.title || job.title;
    const caption =
`╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗠𝗣𝟯 ⚡
╰━━━━━━━━━━━━━━━━╯

🎵 *Título:* ${finalTitle}
👤 *Canal:* ${job.author || res.author || "Desconocido"}
⏱️ *Duración:* ${job.durationTxt || "—"}
💾 *Peso:* ${sizeMB.toFixed(2)} MB
📦 *Tipo:* ${asDocument ? "Documento" : "Audio"}

🤖 *Bot:* La Suki Bot`;

    await conn.sendMessage(job.chatId, {
      [asDocument ? "document" : "audio"]: fs.readFileSync(outFile),
      mimetype: "audio/mpeg",
      fileName: `${safeName(finalTitle)}.mp3`,
      caption: asDocument ? caption : undefined
    }, { quoted: job.commandMsg });

    if (!asDocument) await conn.sendMessage(job.chatId, { text: caption }, { quoted: job.commandMsg });
    await conn.sendMessage(job.chatId, { react: { text: "✅", key: m.key } });
  } catch (e) {
    await conn.sendMessage(job.chatId, { text: `❌ Error: ${e.message}` }, { quoted: m });
    try { await conn.sendMessage(job.chatId, { react: { text: "❌", key: m.key } }); } catch {}
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
