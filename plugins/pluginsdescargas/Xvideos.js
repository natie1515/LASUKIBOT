// commands/xvideos.js — XVideos interactivo (👍 normal / ❤️ documento o 1/2) usando tu API
"use strict";

const axios = require("axios");

// === Config API ===
// Ajusta esto a la URL de tu API
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
// Ajusta tu API Key si es necesaria
const API_KEY  = process.env.API_KEY || "Russellxz";

const MAX_TIMEOUT = 60000; // 60s para dar tiempo al scraper

// ---- helpers ----
function safeFileBase(title, def = "xvideos") {
  const base = String(title || def).slice(0, 70);
  const safe = base.replace(/[^A-Za-z0-9_\-.]+/g, "_");
  return safe || def;
}

function normalizeInputUrl(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  // si pegan www. sin protocolo
  if (!/^https?:\/\//i.test(t) && /^www\./i.test(t)) t = "https://" + t;
  return t;
}

function isXVideosUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/i.test(url.protocol)) return false;
    return url.hostname.includes("xvideos.com");
  } catch {
    return false;
  }
}

// Jobs pendientes por ID del mensaje preview
const pendingXVideos = Object.create(null);

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

async function getXVideosFromSky(url){
  const endpoint = `${API_BASE}/tools/xvideos`; // Ruta del endpoint que creamos

  const { data: res, status: http } = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    }
  );

  let data = res;
  if (typeof data === "string") {
    try { data = JSON.parse(data.trim()); }
    catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${http}`);

  // El endpoint devuelve: { result: { type: "download", result: { title, thumb, low, high } } }
  const payload = data.result || data.data;
  const info = payload.result || payload;

  // Preferir HD, sino SD
  const videoUrl = info.high || info.low;
  
  if (!videoUrl) throw new Error("No se encontró video descargable.");

  // Construir enlace PROXY para descarga segura
  // El endpoint proxy está en /tools/xvideos/dl
  const proxyUrl = `${API_BASE}/tools/xvideos/dl?src=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(safeFileBase(info.title))}&download=1`;

  return {
    title: info.title || "Video XVideos",
    thumb: info.thumb || null,
    video: proxyUrl // Usamos el proxy para evitar bloqueos
  };
}

async function sendVideo(conn, job, asDocument, triggerMsg) {
  const { chatId, url, caption, previewKey, quotedBase, fileBase } = job;

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await react(conn, chatId, previewKey, "⏳");

    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "video"]: { url },
        mimetype: "video/mp4",
        fileName: `${fileBase}.mp4`,
        caption: asDocument ? caption : undefined,
      },
      { quoted: quotedBase || triggerMsg }
    );

    await react(conn, chatId, previewKey, "✅");
    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    console.error("Error enviando video:", e);
    await react(conn, chatId, previewKey, "❌");
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando video (posiblemente muy pesado).` },
      { quoted: quotedBase || triggerMsg }
    );
  }
}

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  let text = normalizeInputUrl(args.join(" "));

  if (!text) {
    return conn.sendMessage(
      chatId,
      { 
        text:
`🔞 **XVideos Downloader**

Usa:
.xvideos <enlace>
.xv <enlace>

Ejemplo:
.xv https://www.xvideos.com/video...`
      },
      { quoted: msg }
    );
  }

  if (!isXVideosUrl(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido. Solo se admiten enlaces de **xvideos.com**.` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getXVideosFromSky(text);

    const title = d.title || "XVideos Video";
    const caption =
`🔞 **XVIDEOS DOWNLOADER**

👍 Enviar video normal
❤️ Enviar como documento
— o responde: 1 = normal · 2 = documento

📌 **Título:** ${title}`;

    // Enviar preview con imagen si hay, sino solo texto
    const msgContent = d.thumb ? { image: { url: d.thumb }, caption } : { text: caption };
    const preview = await conn.sendMessage(chatId, msgContent, { quoted: msg });

    const fileBase = safeFileBase(title, "xvideos");

    pendingXVideos[preview.key.id] = {
      chatId,
      url: d.video,
      fileBase,
      caption: `🔞 **${title}**\n\n⬇️ Descargado vía SkyUltraPlus`,
      quotedBase: msg,
      previewKey: preview.key,
      createdAt: Date.now(),
      processing: false,
    };

    await react(conn, chatId, msg.key, "✅");

    // Listener de interacciones (Singleton pattern simple)
    if (!conn._xvideosInteractiveListener) {
      conn._xvideosInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          if(!m.key.remoteJid) continue;

          try {
            // Limpieza jobs viejos (10 min)
            const now = Date.now();
            for (const k of Object.keys(pendingXVideos)) {
              if (now - (pendingXVideos[k]?.createdAt || 0) > 10 * 60 * 1000) {
                delete pendingXVideos[k];
              }
            }

            // 1. Reacciones (👍 / ❤️)
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingXVideos[reactKey.id];
              
              if (!job || job.chatId !== m.key.remoteJid) continue;
              if (job.processing) continue;

              if (emoji === "👍" || emoji === "❤️") {
                job.processing = true;
                const asDoc = emoji === "❤️";
                await sendVideo(conn, job, asDoc, { key: reactKey, messageTimestamp: m.messageTimestamp });
                delete pendingXVideos[reactKey.id];
              }
              continue;
            }

            // 2. Respuestas (1 / 2)
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();

            if (replyTo && pendingXVideos[replyTo]) {
              const job = pendingXVideos[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;
              if (job.processing) continue;

              if (body === "1" || body === "2") {
                job.processing = true;
                const asDoc = body === "2";
                await sendVideo(conn, job, asDoc, m);
                delete pendingXVideos[replyTo];
              }
            }

          } catch (e) {
            console.error("XVideos listener error:", e);
          }
        }
      });
    }

  } catch (err) {
    console.error("❌ Error XVideos CMD:", err?.message || err);
    let msgTxt = "❌ Error al procesar el video.";
    if (String(err?.message).includes("401")) msgTxt = "🔐 API Key inválida.";
    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["xvideos", "xv"];
module.exports.help = ["xvideos <url>"];
module.exports.tags = ["nsfw", "dl"];
