// comandos/ytmp4.js — YouTube MP4 (URL)
// ✅ Usa la API de resolve unificada (igual que play.js)
// ✅ Selección de Calidades interactiva con Botones
// ✅ Envío asíncrono optimizado sin leer a RAM global

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
const VALID_QUALITIES = new Set(["144", "240", "360", "720", "1080", "1440", "4k"]);
const DEFAULT_QUALITY = "360";
const MAX_MB = 200;
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingYTV = Object.create(null);

function ensureTmp() {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function safeName(name = "video") {
  return String(name).slice(0, 90).replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim() || "video";
}

function fmtDur(sec) {
  const n = Number(sec || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  return (h ? `${h}:` : "") + `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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

async function downloadToFile(url, filePath) {
  const headers = { "User-Agent": "Mozilla/5.0", Accept: "*/*" };
  if (url.includes(new URL(API_BASE).host)) headers["apikey"] = API_KEY;
  const res = await axios.get(url, { responseType: "stream", timeout: 0, headers, maxRedirects: 5, validateStatus: () => true });
  if (res.status >= 400) throw new Error(`HTTP_${res.status}`);
  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

async function callYoutubeResolveVideo(videoUrl, quality) {
  const r = await axios.post(`${API_BASE}/youtube/resolve`, 
    { url: videoUrl, type: "video", quality },
    { headers: { "Content-Type": "application/json", apikey: API_KEY, Accept: "*/*" }, validateStatus: () => true }
  );

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON");
  if (!data.status && !data.ok && !data.success) throw new Error(data.message || data.error || "Error API");
  
  const result = data.result || data.data || data;
  let dl = result.media?.dl_download || result.media?.direct || "";
  if (dl && dl.startsWith("/")) dl = API_BASE + dl;

  return {
    title: result.title || "YouTube",
    duration: result.duration || 0,
    thumbnail: result.thumbnail || "",
    mediaUrl: dl,
  };
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  const url = (args[0] || "").trim();

  if (!url || !/^https?:\/\//i.test(url)) {
    return conn.sendMessage(chatId, { text: `✳️ Usa:\n${pref}${command} <url>\nEj: ${pref}${command} https://youtu.be/xxx` }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    const videoIdMatch = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    const videoId = videoIdMatch ? videoIdMatch[1] : url;
    let title = "YouTube Video", thumbnail = "", durationTxt = "—";
    
    try {
      const searchRes = await yts({ videoId });
      if (searchRes) {
        title = searchRes.title;
        thumbnail = searchRes.thumbnail;
        durationTxt = searchRes.timestamp;
      }
    } catch {}

    const usarBotones = botonesActivos();
    const caption = usarBotones
      ? `⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗶𝗱𝗲𝗼\n\n🎬 ${title}\n⏱️ ${durationTxt}\n\n👇 *Toca el botón para elegir calidad*`
      : `⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗶𝗱𝗲𝗼\n🎬 ${title}\n⏱️ ${durationTxt}\n\nResponde o reacciona:\n👍 Video 360p\n❤️ Documento 360p\n\n(O añade la calidad a tu mensaje: "1 720", "2 1080")`;

    const btns = [{
      text: "📥 Menú de Calidades",
      sections: [
        {
          title: "🎬 VIDEO NORMAL",
          rows: [
            { title: "360p (Recomendado)", id: `${pref}ytmp4_vid_360` },
            { title: "720p (HD)", id: `${pref}ytmp4_vid_720` },
            { title: "1080p (Full HD)", id: `${pref}ytmp4_vid_1080` },
          ]
        },
        {
          title: "📁 VIDEO DOCUMENTO",
          rows: [
            { title: "Documento 360p", id: `${pref}ytmp4_doc_360` },
            { title: "Documento 720p", id: `${pref}ytmp4_doc_720` },
            { title: "Documento 1080p", id: `${pref}ytmp4_doc_1080` },
          ]
        }
      ]
    }];

    let preview;
    const msgPayload = { caption, footer: "🤖 La Suki Bot" };
    if (thumbnail) msgPayload.image = { url: thumbnail };
    if (usarBotones) {
      msgPayload.buttons = btns;
      msgPayload.headerType = thumbnail ? 4 : 1;
    }

    preview = await conn.sendMessage(chatId, msgPayload, { quoted: msg });
    pendingYTV[preview.key.id] = { chatId, url, title, quotedBase: msg, isBusy: false };
    setTimeout(() => { delete pendingYTV[preview.key.id]; }, 10 * 60 * 1000);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

    if (!conn._ytmp4Listener) {
      conn._ytmp4Listener = true;
      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          // Reacciones
          if (m.message?.reactionMessage) {
            const { key, text: emoji } = m.message.reactionMessage;
            const job = pendingYTV[key.id];
            if (job && (emoji === "👍" || emoji === "❤️")) {
              await processSend(conn, job, emoji === "❤️", DEFAULT_QUALITY, m);
            }
            continue;
          }
          // Botones
          const reply = m.message?.interactiveResponseMessage?.nativeFlowResponseMessage || m.message?.listResponseMessage;
          if (reply) {
            let sId = "";
            try {
              if (reply.paramsJson) sId = JSON.parse(reply.paramsJson).id;
              else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) sId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
            } catch {}

            const stanzaId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            const job = pendingYTV[stanzaId];
            if (job && sId) {
              const match = sId.match(/ytmp4_(vid|doc)_(\d+)/);
              if (match) await processSend(conn, job, match[1] === "doc", match[2], m);
            }
            continue;
          }
          // Respuestas
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          if (ctx?.stanzaId && pendingYTV[ctx.stanzaId]) {
            const txt = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
            const qMatch = txt.match(/\b(144|240|360|720|1080|1440)\b/);
            const quality = qMatch ? qMatch[1] : DEFAULT_QUALITY;
            
            if (txt.startsWith("1")) await processSend(conn, pendingYTV[ctx.stanzaId], false, quality, m);
            if (txt.startsWith("2")) await processSend(conn, pendingYTV[ctx.stanzaId], true, quality, m);
          }
        }
      });
    }
  } catch (err) {
    await conn.sendMessage(chatId, { text: `❌ Error: ${err?.message}` }, { quoted: msg });
  }
};

async function processSend(conn, job, asDocument, quality, triggerMsg) {
  if (job.isBusy) return;
  job.isBusy = true;
  const qLabel = `${quality}p`;

  try {
    await conn.sendMessage(job.chatId, { react: { text: asDocument ? "📁" : "🎬", key: triggerMsg.key } });
    await conn.sendMessage(job.chatId, { text: `⏳ Espere, descargando su video (${qLabel})...` }, { quoted: triggerMsg });

    const resolved = await callYoutubeResolveVideo(job.url, quality);
    if (!resolved.mediaUrl) throw new Error("API no retornó URL de video.");

    const tmp = ensureTmp();
    const base = safeName(resolved.title);
    const filePath = path.join(tmp, `yt-${Date.now()}-${base}-${quality}.mp4`);

    await downloadToFile(resolved.mediaUrl, filePath);

    const sizeMB = fs.statSync(filePath).size / (1024 * 1024);
    if (sizeMB > MAX_MB) throw new Error(`El archivo supera el límite de ${MAX_MB}MB`);

    const caption = `⚡ 𝗬𝗼𝘂𝗧𝘂𝗯𝗲 𝗩𝗶𝗱𝗲𝗼\n\n✦ 𝗧𝗶́𝘁𝘂𝗹𝗼: ${resolved.title}\n✦ 𝗖𝗮𝗹𝗶𝗱𝗮𝗱: ${qLabel}\n✦ 𝗣𝗲𝘀𝗼: ${sizeMB.toFixed(2)} MB\n\n🤖 𝗕𝗼𝘁: La Suki Bot`;

    await conn.sendMessage(job.chatId, {
      [asDocument ? "document" : "video"]: { url: filePath },
      mimetype: "video/mp4",
      fileName: `${base}_${quality}.mp4`,
      caption,
    }, { quoted: job.quotedBase });

    await conn.sendMessage(job.chatId, { react: { text: "✅", key: triggerMsg.key } });
    fs.unlinkSync(filePath);
  } catch (e) {
    await conn.sendMessage(job.chatId, { text: `❌ Error: ${e.message}` }, { quoted: job.quotedBase });
  } finally {
    job.isBusy = false;
  }
}

module.exports.command = ["ytmp4", "ytv", "yt4"];
module.exports.help = ["ytmp4 <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
