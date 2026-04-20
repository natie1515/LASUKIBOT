// comandos/ytmp4.js — YouTube MP4 (URL)
// ✅ MISMA RUTA Y ESTRUCTURA DE API que play/ytmp3 (POST /youtube/resolve)
// ✅ Botones rápidos (360p / 720p) + Menú interactivo con todas las calidades
// ✅ Cada opción del menú trae descripción explicativa
// ✅ Respeta activoss.json (sistema de activar/desactivar botones)
// ✅ Sistema de bloqueo isBusy para evitar doble-tap mientras descarga
// ✅ Caption final con toda la info (título, canal, duración, calidad, peso)

"use strict";

const axios = require("axios");
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const DEFAULT_QUALITY = "360";
const MAX_MB = 200;
const VALID_QUALITIES = new Set(["144", "240", "360", "480", "720", "1080", "1440", "4k"]);
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingYTV = {};

// ---------- utils ----------
function safeName(name = "video") {
  return String(name).slice(0, 90).replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim() || "video";
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

function extractQualityFromText(input = "") {
  const t = String(input || "").toLowerCase();
  if (t.includes("4k")) return "4k";
  const m = t.match(/\b(144|240|360|480|720|1080|1440)\s*p?\b/);
  if (m && VALID_QUALITIES.has(m[1])) return m[1];
  return "";
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

// ✅ Misma ruta y estructura que play/ytmp3 — solo cambia type a "video" + quality
async function callYoutubeResolveVideo(videoUrl, quality) {
  const r = await axios.post(`${API_BASE}/youtube/resolve`,
    { url: videoUrl, type: "video", format: "mp4", quality: quality || DEFAULT_QUALITY },
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
    || result.dl_url
    || "";
  if (dl && dl.startsWith("/")) dl = API_BASE + dl;
  return {
    title: result.title || "YouTube Video",
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

  let title = "YouTube Video", thumbnail = "", durationTxt = "—", author = "Desconocido", views = "";
  try {
    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    if (videoIdMatch) {
      const searchRes = await yts({ videoId: videoIdMatch[1] });
      if (searchRes) {
        title = searchRes.title;
        thumbnail = searchRes.thumbnail;
        durationTxt = searchRes.timestamp;
        author = searchRes.author?.name || "Desconocido";
        views = searchRes.views ? Number(searchRes.views).toLocaleString("es") : "";
      }
    }
  } catch {}

  const usarBotones = botonesActivos();

  const caption = usarBotones ?
`╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗜𝗗𝗘𝗢 ⚡
╰━━━━━━━━━━━━━━━━╯

🎬 *Título:* ${title}
👤 *Canal:* ${author}
⏱️ *Duración:* ${durationTxt}${views ? `\n👁️ *Vistas:* ${views}` : ""}

👇 *Toca un botón rápido o abre el menú para más calidades:*`
  :
`╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗜𝗗𝗘𝗢 ⚡
╰━━━━━━━━━━━━━━━━╯

🎬 *Título:* ${title}
👤 *Canal:* ${author}
⏱️ *Duración:* ${durationTxt}${views ? `\n👁️ *Vistas:* ${views}` : ""}

🟡 *OPCIÓN 1 — Reaccionar a este mensaje*
   👍  →  Video Normal (360p)
   📁  →  Video como Documento (360p)

🔵 *OPCIÓN 2 — Responder citando este mensaje*
   *1* o *video*    → Video Normal
   *2* o *videodoc* → Video como Documento

💡 _Tip: Puedes añadir la calidad. Ej: "video 720", "2 1080", "video 4k"_`;

  // ✅ Botones rápidos (quick_reply) + Menú interactivo (single_select)
  const nativeFlowButtons = [
    { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🎬 360p", id: `${pref}ytmp4_vid_360` }) },
    { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🎬 720p HD", id: `${pref}ytmp4_vid_720` }) },
    {
      name: "single_select",
      buttonParamsJson: JSON.stringify({
        title: "📥 Más calidades / Documento",
        sections: [
          {
            title: "🎬 VIDEO NORMAL",
            rows: [
              { header: "Recomendado", title: "🎬 360p", description: "Calidad estándar — descarga rápida y archivo liviano", id: `${pref}ytmp4_vid_360` },
              { header: "Buena",       title: "🎬 480p", description: "Buen balance entre calidad y tamaño", id: `${pref}ytmp4_vid_480` },
              { header: "HD",          title: "🎬 720p HD", description: "Alta definición — recomendado para ver en celular", id: `${pref}ytmp4_vid_720` },
              { header: "Full HD",     title: "🎬 1080p Full HD", description: "Mejor calidad — archivo más pesado", id: `${pref}ytmp4_vid_1080` }
            ]
          },
          {
            title: "📁 COMO DOCUMENTO (sin compresión de WhatsApp)",
            rows: [
              { header: "", title: "📁 Documento 360p",  description: "Conserva calidad original sin re-compresión", id: `${pref}ytmp4_doc_360` },
              { header: "", title: "📁 Documento 480p",  description: "Conserva calidad original sin re-compresión", id: `${pref}ytmp4_doc_480` },
              { header: "", title: "📁 Documento 720p",  description: "HD sin re-compresión de WhatsApp", id: `${pref}ytmp4_doc_720` },
              { header: "", title: "📁 Documento 1080p", description: "Full HD sin re-compresión de WhatsApp", id: `${pref}ytmp4_doc_1080` }
            ]
          }
        ]
      })
    }
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

  // Guardar estado del job
  pendingYTV[preview.key.id] = {
    chatId: msg.key.remoteJid, url, title, thumbnail, author, durationTxt, views,
    commandMsg: msg, isBusy: false, quality: DEFAULT_QUALITY, _createdAt: Date.now()
  };
  setTimeout(() => { delete pendingYTV[preview.key.id]; }, 10 * 60 * 1000);

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

  // ====== Listener único (mismo patrón que play/ytmp3) ======
  if (!conn._ytmp4Listener) {
    conn._ytmp4Listener = true;
    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {

        // 1) REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pendingYTV[reactKey.id];
          if (job) {
            if (emoji === "👍" || emoji === "❤️") await downloadVideo(conn, job, false, job.quality, m);
            if (emoji === "📁") await downloadVideo(conn, job, true, job.quality, m);
          }
          continue;
        }

        // 2) BOTONES INTERACTIVOS / MENÚ
        try {
          const interactiveReply =
               m.message?.interactiveResponseMessage?.nativeFlowResponseMessage
            || m.message?.listResponseMessage
            || m.message?.buttonsResponseMessage
            || m.message?.templateButtonReplyMessage
            || null;

          if (interactiveReply) {
            let selectedId = "";
            if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
              selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
            } else if (interactiveReply?.paramsJson) {
              try { selectedId = JSON.parse(interactiveReply.paramsJson).id || ""; } catch {}
            } else if (m.message?.buttonsResponseMessage?.selectedButtonId) {
              selectedId = m.message.buttonsResponseMessage.selectedButtonId;
            } else if (m.message?.templateButtonReplyMessage?.selectedId) {
              selectedId = m.message.templateButtonReplyMessage.selectedId;
            }

            if (!selectedId) continue;
            // Solo reacciona a IDs propios de ytmp4 (evita conflicto con ytmp3)
            if (!selectedId.includes("ytmp4_")) continue;

            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;
            if (ctxQuoted && pendingYTV[ctxQuoted]) {
              job = pendingYTV[ctxQuoted];
            } else {
              const jobsInChat = Object.entries(pendingYTV)
                .filter(([, j]) => j.chatId === m.key.remoteJid)
                .sort(([, a], [, b]) => (b._createdAt || 0) - (a._createdAt || 0));
              if (jobsInChat.length > 0) job = jobsInChat[0][1];
            }

            if (!job) continue;

            const match = selectedId.match(/ytmp4_(vid|doc)_(\d+|4k)/);
            if (match) await downloadVideo(conn, job, match[1] === "doc", match[2], m);
            continue;
          }
        } catch (e) {}

        // 3) RESPUESTAS CITADAS
        try {
          const citado = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          const texto = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
          const job = pendingYTV[citado];

          if (citado && job) {
            const qFromReply = extractQualityFromText(texto) || job.quality;
            const firstWord = texto.split(/\s+/)[0];

            if (["1", "video"].includes(firstWord)) await downloadVideo(conn, job, false, qFromReply, m);
            else if (["2", "videodoc", "doc", "documento"].includes(firstWord)) await downloadVideo(conn, job, true, qFromReply, m);
          }
        } catch (e) {}
      }
    });
  }
};

async function downloadVideo(conn, job, asDocument, quality, m) {
  // ✅ Sistema de bloqueo: si ya está procesando, avisa y sale
  if (job.isBusy) {
    try {
      await conn.sendMessage(job.chatId, {
        text: "⌛ Ya estoy procesando este video, espere a que termine la descarga actual..."
      }, { quoted: m });
    } catch {}
    return;
  }
  job.isBusy = true;

  const tmp = ensureTmp();
  const outFile = path.join(tmp, `yt-${Date.now()}_${quality}.mp4`);
  const qLabel = quality === "4k" ? "4K" : `${quality}p`;

  try {
    await conn.sendMessage(job.chatId, { react: { text: asDocument ? "📁" : "🎬", key: m.key } });
    await conn.sendMessage(job.chatId, {
      text: `⏳ Descargando video en *${qLabel}*${asDocument ? " (como documento)" : ""}...\n_Esto puede tardar unos segundos._`
    }, { quoted: m });

    const res = await callYoutubeResolveVideo(job.url, quality);
    if (!res.mediaUrl) throw new Error("La API no retornó URL del video.");

    await downloadToFile(res.mediaUrl, outFile);

    const sizeMB = fileSizeMB(outFile);
    if (sizeMB > MAX_MB) {
      throw new Error(`El archivo (${sizeMB.toFixed(2)} MB) supera el límite de ${MAX_MB} MB. Intenta con una calidad menor.`);
    }

    const finalTitle = res.title || job.title;
    const caption =
`╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗶𝗱𝗲𝗼 ⚡
╰━━━━━━━━━━━━━━━━╯

🎬 *Título:* ${finalTitle}
👤 *Canal:* ${job.author || res.author || "Desconocido"}
⏱️ *Duración:* ${job.durationTxt || "—"}
🎚️ *Calidad:* ${qLabel}
💾 *Peso:* ${sizeMB.toFixed(2)} MB
📦 *Tipo:* ${asDocument ? "Documento" : "Video"}

🤖 *Bot:* La Suki Bot`;

    await conn.sendMessage(job.chatId, {
      [asDocument ? "document" : "video"]: fs.readFileSync(outFile),
      mimetype: "video/mp4",
      fileName: `${safeName(finalTitle)}_${quality}.mp4`,
      caption,
    }, { quoted: job.commandMsg });

    await conn.sendMessage(job.chatId, { react: { text: "✅", key: m.key } });
  } catch (e) {
    await conn.sendMessage(job.chatId, { text: `❌ Error: ${e.message}` }, { quoted: m });
    try { await conn.sendMessage(job.chatId, { react: { text: "❌", key: m.key } }); } catch {}
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
    job.isBusy = false;
  }
}

module.exports.command = ["ytmp4", "ytv", "yt4"];
module.exports.help = ["ytmp4 <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
