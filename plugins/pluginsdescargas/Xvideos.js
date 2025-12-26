// commands/xvideos.js — XVideos Downloader (SD por defecto, añade "hd" para alta)
// ✅ Parser de URL robusto (www/m/https/pegado en texto)
// ✅ Soporta estructuras JSON distintas (result.data, result, data, media)
// ✅ Soporta llaves distintas (low/high, sd/hd, video_sd/video_hd)
// ✅ Fallback: intenta proxy /dl y si falla usa URL directa

"use strict";

const axios = require("axios");

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";
const MAX_TIMEOUT = 60000;

// ---- helpers ----
function safeFileBase(title, def = "xvideos") {
  const base = String(title || def).slice(0, 70);
  const safe = base.replace(/[^A-Za-z0-9_\-.]+/g, "_");
  return safe || def;
}

function pickText(m) {
  return String(
    m?.message?.conversation ||
      m?.message?.extendedTextMessage?.text ||
      m?.text ||
      ""
  ).trim();
}

function extractXVideosUrl(raw = "") {
  const t = String(raw || "").trim();

  // busca URL completa en el texto
  const m1 = t.match(/https?:\/\/[^\s]+/i);
  if (m1 && /xvideos\.com/i.test(m1[0])) return cleanupUrl(m1[0]);

  // busca xvideos.com/... sin http
  const m2 = t.match(/(?:www\.|m\.)?xvideos\.com\/[^\s]+/i);
  if (m2) return cleanupUrl("https://" + m2[0].replace(/^https?:\/\//i, ""));

  return "";
}

function cleanupUrl(u) {
  return String(u || "")
    .trim()
    .replace(/[)\],.]+$/g, ""); // quita basura al final
}

function normalizeInput(args, msg) {
  const raw = args?.length ? args.join(" ") : pickText(msg);
  const low = raw.toLowerCase();

  const isHd = /\bhd\b/.test(low);
  const url = extractXVideosUrl(raw);

  return { url, isHd };
}

async function react(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

function unwrapApiResponse(data) {
  // Tu API suele devolver: { status:true, result: {...} }
  // Pero a veces: { status:true, data: {...} } o el contenido directo
  const root = data?.result ?? data?.data ?? data;

  // y dentro: { data: {...} }
  return root?.data ?? root;
}

function pickLink(info) {
  // soporta varios nombres posibles
  return {
    hd:
      info?.high ||
      info?.hd ||
      info?.video_hd ||
      info?.media?.video_hd ||
      info?.media?.hd ||
      "",
    sd:
      info?.low ||
      info?.sd ||
      info?.video_sd ||
      info?.media?.video_sd ||
      info?.media?.sd ||
      "",
  };
}

async function getXVideosFromSky(url, wantHd) {
  const endpoint = `${API_BASE}/tools/xvideos`;

  const r = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: () => true,
    }
  );

  const http = r.status;
  let data = r.data;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw new Error(`Respuesta no JSON del servidor (HTTP ${http})`);
    }
  }

  const ok = data?.status === true || data?.status === "true" || data?.ok === true || data?.success === true;
  if (!ok) {
    const msg = data?.message || data?.error || `HTTP ${http}`;
    throw new Error(msg);
  }

  const info = unwrapApiResponse(data);
  if (!info) throw new Error("API sin datos");

  const title = info?.title || info?.data?.title || "Video XVideos";
  const thumb = info?.thumb || info?.thumbnail || info?.image || null;

  const links = pickLink(info);

  let rawVideoUrl = "";
  let qualityLabel = "";

  if (wantHd) {
    rawVideoUrl = links.hd || links.sd;
    qualityLabel = links.hd ? "HD (Alta)" : "SD (Baja - HD no disponible)";
  } else {
    rawVideoUrl = links.sd || links.hd;
    qualityLabel = links.sd ? "SD (Baja)" : "HD (Alta - SD no disponible)";
  }

  if (!rawVideoUrl) throw new Error("No se encontró link descargable (sd/hd).");

  // Proxy (para que WhatsApp pueda descargar sin headers)
  const proxyUrl = `${API_BASE}/tools/xvideos/dl?src=${encodeURIComponent(rawVideoUrl)}&filename=${encodeURIComponent(
    safeFileBase(title)
  )}&download=1`;

  return {
    title,
    thumb,
    quality: qualityLabel,
    proxy: proxyUrl,
    direct: rawVideoUrl,
  };
}

async function sendVideoWithFallback(conn, chatId, quoted, caption, urls) {
  // 1) intenta proxy
  try {
    await conn.sendMessage(
      chatId,
      {
        video: { url: urls.proxy },
        mimetype: "video/mp4",
        caption,
      },
      { quoted }
    );
    return true;
  } catch (e) {
    // 2) si proxy falla, intenta directo
    try {
      await conn.sendMessage(
        chatId,
        {
          video: { url: urls.direct },
          mimetype: "video/mp4",
          caption,
        },
        { quoted }
      );
      return true;
    } catch (e2) {
      throw e2;
    }
  }
}

module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = (global.prefixes && global.prefixes[0]) || ".";
  const { url, isHd } = normalizeInput(args, msg);

  if (!url) {
    return conn.sendMessage(
      chatId,
      {
        text:
`🔞 *XVideos Downloader*

✳️ Usa:
${pref}${command} <link>
${pref}${command} <link> hd

Ej:
${pref}${command} https://www.xvideos.com/videoXXXX
${pref}${command} https://www.xvideos.com/videoXXXX hd`,
      },
      { quoted: msg }
    );
  }

  // mini-validación
  if (!/xvideos\.com/i.test(url)) {
    return conn.sendMessage(chatId, { text: "❌ Link inválido de XVideos." }, { quoted: msg });
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getXVideosFromSky(url, isHd);

    const caption =
`🔞 ${d.title}
📺 Calidad: ${d.quality}`;

    await sendVideoWithFallback(conn, chatId, msg, caption, { proxy: d.proxy, direct: d.direct });

    await react(conn, chatId, msg.key, "✅");
  } catch (err) {
    console.error("❌ Error XVideos CMD:", err?.message || err);

    const em = String(err?.message || "");
    let msgTxt = "❌ Error al procesar el video.";

    if (/invalid_api_key|apikey|401/i.test(em)) msgTxt = "🔐 API Key inválida o no autorizada.";
    else if (/404/i.test(em)) msgTxt = "❌ Endpoint no existe (404). Revisa si es /tools/xvideos y si tienes /tools/xvideos/dl.";
    else if (em) msgTxt = `❌ Error: ${em}`;

    await conn.sendMessage(chatId, { text: msgTxt }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["xvideos", "xv"];
module.exports.help = ["xvideos <url> [hd]"];
module.exports.tags = ["nsfw", "dl"];
module.exports.register = true;
