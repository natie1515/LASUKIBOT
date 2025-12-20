
// plugins/porn.js — Pornhub Downloader (via tu API /phfans)
// ✅ Default calidad: 240
// ✅ Calidad opcional: 240 / 480 / 720 / 1080
// ✅ Reacciones: 👍 (Video) / ❤️ (Documento) o Respuestas 1 / 2
// ✅ DESCARGA REAL (direct url) y ENVÍA el MP4 por WhatsApp
"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api-sky.ultraplus.click";
const API_KEY = "Russellxz";
const ENDPOINT = "/phfans";

const MAX_MB = 200;
const pendingPORN = Object.create(null);

const mb = (n) => n / (1024 * 1024);

function isUrl(u = "") {
  return /^https?:\/\//i.test(String(u || ""));
}

function isPornhub(u = "") {
  u = String(u || "");
  return /pornhub\./i.test(u) && /view_video\.php\?viewkey=/i.test(u);
}

function normalizeUrl(input = "") {
  let u = String(input || "").trim().replace(/^<|>$/g, "").trim();
  if (/^(www\.)?pornhub\./i.test(u)) u = "https://" + u;
  return u;
}

function safeFileName(name = "phfans") {
  const base = String(name || "phfans").slice(0, 70);
  return base.replace(/[^A-Za-z0-9_\-.]+/g, "_") || "phfans";
}

function pickQualityFromText(text = "") {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  const qRaw = parts.find((p) => /\d{3,4}/.test(p)) || "";
  const n = Number(String(qRaw).replace(/[^\d]/g, ""));
  if ([240, 480, 720, 1080].includes(n)) return n;
  return 240;
}

function extractUrl(text = "") {
  const parts = String(text || "").split(/\s+/).filter(Boolean);
  const u = parts.find((p) => isUrl(p)) || parts[0] || "";
  return normalizeUrl(u);
}

function pickText(msg) {
  const m = msg?.message || {};
  return String(
    m?.conversation ||
      m?.extendedTextMessage?.text ||
      m?.imageMessage?.caption ||
      m?.videoMessage?.caption ||
      ""
  ).trim();
}

async function react(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

async function getPhfansInfo(url) {
  const endpoint = API_BASE.replace(/\/+$/, "") + ENDPOINT;
  const r = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
      },
      timeout: 60000,
      validateStatus: () => true,
    }
  );

  const data = r.data;
  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || "Error en la API /phfans");
  return data.result;
}

function selectVideoFromApi(result, wantQ = 240) {
  const arr = Array.isArray(result?.videos) ? result.videos : [];
  if (!arr.length) return null;

  const qStr = String(wantQ);

  // IMPORTANTE:
  // tu API trae: { quality, url (direct), proxy_inline, proxy }
  // para evitar 401, usamos DIRECTO (url) primero
  let pick =
    arr.find((v) => String(v.quality || "") === qStr) ||
    arr.find((v) => String(v.quality || "").includes(qStr)) ||
    null;

  if (!pick) {
    // fallback: el más bajo
    const sorted = arr
      .slice()
      .sort((a, b) => (Number(a.quality) || 999999) - (Number(b.quality) || 999999));
    pick = sorted[0] || null;
  }

  if (!pick) return null;

  const direct = String(pick.url || "").trim(); // <-- DIRECTO
  const proxy = String(pick.proxy || pick.proxy_inline || "").trim();

  return {
    quality: String(pick.quality || wantQ),
    direct,
    proxy,
    raw: pick,
  };
}

async function downloadToTmpDirect(srcUrl, title, quality) {
  if (!srcUrl || !isUrl(srcUrl)) throw new Error("URL directa inválida");

  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const base = safeFileName(title || "phfans");
  const q = String(quality || "240");
  const outName = `${base}_${q}p.mp4`;
  const filePath = path.join(tmpDir, `ph-${Date.now()}-${q}.mp4`);

  const ctrl = new AbortController();
  let downloaded = 0;
  const maxBytes = MAX_MB * 1024 * 1024;

  const res = await axios.get(srcUrl, {
    responseType: "stream",
    timeout: 180000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    signal: ctrl.signal,
    headers: {
      // headers típicos que ayudan con estos hosts/token
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
      Referer: "https://pornhubfans.com/",
    },
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`No se pudo descargar directo (HTTP ${res.status})`);
  }

  const ct = String(res.headers?.["content-type"] || "");
  if (ct.includes("application/json") || ct.includes("text/html")) {
    // a veces devuelven error en vez de mp4
    let txt = "";
    await new Promise((resolve) => {
      res.data.on("data", (c) => (txt += c.toString()));
      res.data.on("end", resolve);
      res.data.on("error", resolve);
    });
    throw new Error("Upstream no devolvió MP4: " + txt.slice(0, 180));
  }

  const writer = fs.createWriteStream(filePath);

  res.data.on("data", (chunk) => {
    downloaded += chunk.length;
    if (downloaded > maxBytes) {
      try { ctrl.abort(); } catch {}
      try { writer.destroy(); } catch {}
      try { fs.unlinkSync(filePath); } catch {}
    }
  });

  res.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
    res.data.on("error", reject);
  });

  if (!fs.existsSync(filePath)) {
    throw new Error(`El video excede ${MAX_MB}MB o falló la descarga.`);
  }

  return { filePath, fileName: outName };
}

async function sendPorn(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;

  const { chatId, quotedBase, title, chosen, thumb } = job;
  const q = String(chosen?.quality || "240");

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await conn.sendMessage(chatId, { text: "⏳ Espere, descargando su video..." }, { quoted: quotedBase });

    // descarga directa para evitar 401
    const { filePath, fileName } = await downloadToTmpDirect(chosen.direct, title, q);

    const caption =
      `✅ *PORNHUB DOWNLOADER*\n\n` +
      `📝 *Título:* ${title}\n` +
      `🎞️ *Calidad:* ${q}p\n\n` +
      `🔗 API: ${API_BASE}`;

    await conn.sendMessage(
      chatId,
      asDocument
        ? {
            document: { url: filePath },
            mimetype: "video/mp4",
            fileName,
            caption,
          }
        : {
            video: { url: filePath },
            mimetype: "video/mp4",
            fileName,
            caption,
          },
      { quoted: quotedBase }
    );

    try { fs.unlinkSync(filePath); } catch {}
    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    // fallback: si no pudo descargar/enviar, manda link directo
    const fallback =
      `❌ No pude enviar el MP4.\n` +
      `Motivo: ${e?.message || e}\n\n` +
      `Link directo (${q}p): ${chosen?.direct || "N/A"}`;

    await conn.sendMessage(chatId, { text: fallback }, { quoted: quotedBase });
    await react(conn, chatId, triggerMsg.key, "❌");
  } finally {
    job.isBusy = false;
  }
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  try { await react(conn, chatId, msg.key, "⏳"); } catch {}

  const text = args?.length ? args.join(" ") : pickText(msg);
  const url = extractUrl(text);
  const wantQ = pickQualityFromText(text);

  if (!url || !isPornhub(url)) {
    await conn.sendMessage(
      chatId,
      {
        text:
          `✳️ *Uso:*\n` +
          `${pref}${command || "porn"} https://es.pornhub.com/view_video.php?viewkey=XXXX\n` +
          `Opcional calidad: 240 / 480 / 720 / 1080 (default 240)\n\n` +
          `Ej:\n` +
          `${pref}${command || "porn"} https://es.pornhub.com/view_video.php?viewkey=68aaa9a034cca 720`,
      },
      { quoted: msg }
    );
    try { await react(conn, chatId, msg.key, "❌"); } catch {}
    return;
  }

  let result;
  try {
    result = await getPhfansInfo(url);
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error consultando API:\n${e.message || e}` }, { quoted: msg });
    try { await react(conn, chatId, msg.key, "❌"); } catch {}
    return;
  }

  const title = String(result?.title || "Pornhub Video").slice(0, 120);
  const thumb =
    String(result?.thumbnail?.proxy_inline || result?.thumbnail?.proxy || result?.thumbnail?.url || result?.thumbnail || "").trim();

  const chosen = selectVideoFromApi(result, wantQ);
  if (!chosen?.direct) {
    await conn.sendMessage(chatId, { text: "❌ No encontré link directo de video en la respuesta de la API." }, { quoted: msg });
    try { await react(conn, chatId, msg.key, "❌"); } catch {}
    return;
  }

  const caption =
    `✅ *PORNHUB DOWNLOADER*\n\n` +
    `📝 *Título:* ${title}\n` +
    `🎞️ *Calidad:* ${chosen.quality || wantQ}p\n\n` +
    `Elige cómo enviarlo:\n` +
    `👍 Video (normal)\n` +
    `❤️ Video como documento\n` +
    `— o responde: 1 = normal · 2 = documento`;

  let preview;
  try {
    if (thumb && isUrl(thumb)) {
      preview = await conn.sendMessage(chatId, { image: { url: thumb }, caption }, { quoted: msg });
    } else {
      preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
    }
  } catch {
    preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
  }

  pendingPORN[preview.key.id] = {
    chatId,
    quotedBase: msg,
    title,
    thumb,
    chosen,
    isBusy: false,
  };

  setTimeout(() => {
    if (pendingPORN[preview.key.id]) delete pendingPORN[preview.key.id];
  }, 10 * 60 * 1000);

  try { await react(conn, chatId, msg.key, "✅"); } catch {}

  // Listener (una vez)
  if (!conn._pornInteractiveListener) {
    conn._pornInteractiveListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages || []) {
        try {
          // Reacciones
          if (m.message?.reactionMessage) {
            const { key: reactKey, text: emoji } = m.message.reactionMessage;
            const job = pendingPORN[reactKey.id];
            if (!job || job.chatId !== m.key.remoteJid) continue;
            if (emoji !== "👍" && emoji !== "❤️") continue;
            if (job.isBusy) continue;

            await sendPorn(conn, job, emoji === "❤️", m);
            continue;
          }

          // Reply 1/2
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          if (ctx?.stanzaId && pendingPORN[ctx.stanzaId]) {
            const job = pendingPORN[ctx.stanzaId];
            if (!job || job.chatId !== m.key.remoteJid) continue;

            const body = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
            if (body !== "1" && body !== "2") continue;
            if (job.isBusy) continue;

            await sendPorn(conn, job, body === "2", m);
          }
        } catch (e) {
          console.error("PORN listener error:", e);
        }
      }
    });
  }
};

handler.command = ["porn"];
handler.help = ["porn <url> [240|480|720|1080]"];
handler.tags = ["descargas"];
handler.register = true;

module.exports = handler;
