// plugins/porn.js — Pornhub Downloader (via tu API /phfans)
// Uso:
// 1) .porn https://es.pornhub.com/view_video.php?viewkey=XXXXX
// 2) .porn https://... 720   (calidades: 240/480/720/1080)
// Default: 240
"use strict";

const fetch = require("node-fetch");

const API_BASE = "https://api-sky.ultraplus.click";
const API_KEY = "Russellxz";
const ENDPOINT = "/phfans";

function pickText(msg) {
  // intenta sacar texto del mensaje o citado (lo más simple y útil)
  const m = msg?.message || {};
  const t =
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    "";
  return String(t || "").trim();
}

function normalizeQ(q) {
  q = String(q || "").toLowerCase().replace(/[^\d]/g, "");
  const n = Number(q);
  if ([240, 480, 720, 1080].includes(n)) return n;
  return 240;
}

function extractUrlAndQ(text) {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  const url = parts.find((p) => /^https?:\/\//i.test(p)) || "";
  // calidad: primer número válido que aparezca
  const qRaw = parts.find((p) => /\d{3,4}/.test(p)) || "";
  const q = normalizeQ(qRaw);
  return { url, q };
}

function selectVideo(videos, wantQ) {
  // videos puede ser array o objeto
  let arr = [];
  if (Array.isArray(videos)) arr = videos;
  else if (videos && typeof videos === "object") {
    // { "240p": {url,proxy}, ... } o {240:{...}}
    arr = Object.entries(videos).map(([k, v]) => ({
      quality: k,
      ...v,
    }));
  }

  const qStr1 = `${wantQ}p`;
  const qStr2 = `${wantQ}`;

  // match por quality/label
  let pick =
    arr.find((x) => String(x.quality || x.label || x.q || "").toLowerCase() === qStr1) ||
    arr.find((x) => String(x.quality || x.label || x.q || "").toLowerCase() === qStr2) ||
    null;

  // si no existe, intenta por el número incluido
  if (!pick) {
    pick =
      arr.find((x) => String(x.quality || x.label || "").includes(String(wantQ))) ||
      null;
  }

  // fallback: el más bajo disponible
  if (!pick && arr.length) {
    const withNum = arr
      .map((x) => {
        const s = String(x.quality || x.label || x.q || "");
        const n = Number(String(s).replace(/[^\d]/g, "")) || 999999;
        return { n, x };
      })
      .sort((a, b) => a.n - b.n);
    pick = withNum[0]?.x || arr[0];
  }

  if (!pick) return null;

  const url = pick.proxy || pick.url || pick.direct || pick.src || null;
  const quality =
    pick.quality ||
    pick.label ||
    (wantQ ? `${wantQ}p` : "") ||
    "";

  return { url, quality, raw: pick };
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });
  } catch {}

  // URL puede venir en args o en el texto del mensaje
  const text = args?.length ? args.join(" ") : pickText(msg);
  const { url, q } = extractUrlAndQ(text);

  if (!url || !/pornhub\.com\/view_video\.php\?viewkey=/i.test(url)) {
    await conn.sendMessage(chatId, {
      text:
        `✳️ *Uso:*\n` +
        `.${command || "porn"} https://es.pornhub.com/view_video.php?viewkey=XXXX\n` +
        `Opcional calidad: 240 / 480 / 720 / 1080\n\n` +
        `Ej:\n` +
        `.${command || "porn"} https://es.pornhub.com/view_video.php?viewkey=68aaa9a034cca 720`,
      quoted: msg,
    });
    try {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    } catch {}
    return;
  }

  // llamar tu API
  let data;
  try {
    const r = await fetch(API_BASE.replace(/\/+$/, "") + ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
      },
      body: JSON.stringify({ url }),
      timeout: 120000,
    });

    const txt = await r.text();
    try {
      data = JSON.parse(txt);
    } catch {
      throw new Error("Respuesta no JSON: " + txt.slice(0, 200));
    }

    if (!r.ok || data?.status === false) {
      throw new Error(data?.message || `HTTP ${r.status}`);
    }
  } catch (e) {
    await conn.sendMessage(chatId, {
      text: `❌ Error consultando API:\n${e.message || e}`,
      quoted: msg,
    });
    try {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    } catch {}
    return;
  }

  const result = data?.result || {};
  const videos = result?.videos || result?.video || result?.links || result?.medias;

  const chosen = selectVideo(videos, q);
  if (!chosen?.url) {
    await conn.sendMessage(chatId, {
      text: `❌ No encontré link de video en la respuesta de la API.`,
      quoted: msg,
    });
    try {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    } catch {}
    return;
  }

  const title = String(result?.title || "Pornhub Video").slice(0, 120);
  const thumb = result?.thumbnail || result?.thumb || result?.cover || null;

  // En WA es mejor mandar link (muchos videos pesan demasiado para enviar directo)
  let out =
    `✅ *PORNHUB DOWNLOADER*\n` +
    `📌 *Título:* ${title}\n` +
    `🎞️ *Calidad:* ${chosen.quality || `${q}p`}\n` +
    `🔗 *Link:* ${chosen.url}`;

  try {
    if (thumb && /^https?:\/\//i.test(thumb)) {
      await conn.sendMessage(
        chatId,
        {
          image: { url: thumb },
          caption: out,
        },
        { quoted: msg }
      );
    } else {
      await conn.sendMessage(chatId, { text: out }, { quoted: msg });
    }
    try {
      await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
    } catch {}
  } catch (e) {
    // fallback texto
    await conn.sendMessage(chatId, { text: out }, { quoted: msg });
    try {
      await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
    } catch {}
  }
};

handler.command = ["porn"];
handler.help = ["porn <url> [240|480|720|1080]"];
handler.tags = ["descargas"];
handler.register = true;

module.exports = handler;
