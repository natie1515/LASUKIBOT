// commands/xvideos.js — XVideos Downloader (Por defecto SD, añade 'hd' para alta calidad)
"use strict";

const axios = require("axios");

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY || "Russellxz";

const MAX_TIMEOUT = 60000; // 60s timeout

// ---- helpers ----
function safeFileBase(title, def = "xvideos") {
  const base = String(title || def).slice(0, 70);
  const safe = base.replace(/[^A-Za-z0-9_\-.]+/g, "_");
  return safe || def;
}

function normalizeInput(args) {
  // Unir argumentos y separar URL de flags
  const raw = args.join(" ").trim();
  const parts = raw.split(/\s+/);
  
  let url = "";
  let isHd = false;

  for (const p of parts) {
    if (p.toLowerCase() === "hd") isHd = true;
    else if (p.includes("xvideos.com")) url = p;
  }

  if (url && !/^https?:\/\//i.test(url) && /^www\./i.test(url)) {
    url = "https://" + url;
  }

  return { url, isHd };
}

async function react(conn, chatId, key, emoji) {
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

async function getXVideosFromSky(url, wantHd) {
  const endpoint = `${API_BASE}/tools/xvideos`;

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

  // Estructura: { result: { data: { title, thumb, low, high } } }
  const payload = data.result || data.data;
  const info = payload.data || payload;

  // Lógica de selección de calidad
  // Si quiere HD y existe high -> high
  // Si quiere HD y NO existe high -> low (fallback)
  // Si NO quiere HD -> low (si existe), sino high
  let videoUrl = "";
  let qualityLabel = "";

  if (wantHd) {
    if (info.high) {
      videoUrl = info.high;
      qualityLabel = "HD (Alta)";
    } else {
      videoUrl = info.low;
      qualityLabel = "SD (Baja - HD no disponible)";
    }
  } else {
    if (info.low) {
      videoUrl = info.low;
      qualityLabel = "SD (Baja)";
    } else {
      videoUrl = info.high;
      qualityLabel = "HD (Alta - SD no disponible)";
    }
  }
  
  if (!videoUrl) throw new Error("No se encontró video descargable.");

  // Usar Proxy para descarga
  const proxyUrl = `${API_BASE}/tools/xvideos/dl?src=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(safeFileBase(info.title))}&download=1`;

  return {
    title: info.title || "Video XVideos",
    thumb: info.thumb || null,
    video: proxyUrl,
    quality: qualityLabel
  };
}

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const { url, isHd } = normalizeInput(args);

  if (!url) {
    return conn.sendMessage(
      chatId,
      { 
        text:
`🔞 **XVideos Downloader**

Modo Normal (SD):
.xv <enlace>

Modo Alta Calidad (HD):
.xv <enlace> hd

Ejemplo:
.xv https://www.xvideos.com/video... hd`
      },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getXVideosFromSky(url, isHd);

    const caption =
`🔞 **${d.title}**

📺 Calidad: ${d.quality}
⬇️ Descargado vía SkyUltraPlus`;

    // Enviar video directamente (sin menú interactivo para ser más rápido)
    await conn.sendMessage(
      chatId,
      {
        video: { url: d.video },
        caption: caption,
        mimetype: "video/mp4"
      },
      { quoted: msg }
    );

    await react(conn, chatId, msg.key, "✅");

  } catch (err) {
    console.error("❌ Error XVideos CMD:", err?.message || err);
    let msgTxt = "❌ Error al procesar el video.";
    if (String(err?.message).includes("401")) msgTxt = "🔐 API Key inválida.";
    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["xvideos", "xv"];
module.exports.help = ["xvideos <url> [hd]"];
module.exports.tags = ["nsfw", "dl"];

