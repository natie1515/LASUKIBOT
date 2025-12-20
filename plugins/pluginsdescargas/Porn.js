// plugins/porn.js — Pornhub Downloader (PHFans API)
// ✅ Default calidad: 240
// ✅ Calidad opcional: 240 / 480 / 720 / 1080
// ✅ Reacciones: 👍 (Video) / ❤️ (Documento) o Respuestas 1 / 2
// ✅ Descarga REAL y envía el MP4

"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

// === API ===
const API_BASE = "https://api-sky.ultraplus.click";
const API_KEY = "Russellxz"; // tu apikey

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

function pickQuality(args = []) {
  const q = String(args.find((x) => /^\d{3,4}$/.test(String(x))) || "").trim();
  const n = Number(q);
  if ([240, 480, 720, 1080].includes(n)) return n;
  return 240;
}

async function react(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

// Convierte /phfans/dl?... => https://api-sky.../phfans/dl?...
function absApi(u) {
  u = String(u || "").trim();
  if (!u) return "";
  if (u.startsWith("/")) return API_BASE.replace(/\/+$/, "") + u;
  if (isUrl(u)) return u;
  return API_BASE.replace(/\/+$/, "") + "/" + u.replace(/^\/+/, "");
}

// 1) Resolver info (POST /phfans)
async function getPhfansInfo(url) {
  const endpoint = API_BASE.replace(/\/+$/, "") + "/phfans";
  const r = await axios.post(
    endpoint,
    { url },
    {
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        "x-api-key": API_KEY,
        Authorization: `Bearer ${API_KEY}`,
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

// 2) Elegir video por calidad (por defecto 240)
function pickVideoByQuality(result, wantQ = 240) {
  const vids = Array.isArray(result?.videos) ? result.videos : [];
  if (!vids.length) return null;

  const qStr = String(wantQ);

  let pick =
    vids.find((v) => String(v.quality || "") === qStr) ||
    vids.find((v) => String(v.quality || "").includes(qStr)) ||
    null;

  // fallback: más baja disponible
  if (!pick) {
    const sortedAsc = vids
      .slice()
      .sort((a, b) => (Number(a.quality) || 0) - (Number(b.quality) || 0));
    pick = sortedAsc[0] || null;
  }

  return pick;
}

// 3) Descargar usando PROXY de tu API (GET /phfans/dl ... download=1)
async function downloadPhVideoToTmp(pick, title) {
  const tmpDir = path.resolve("./tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const base = safeFileName(title || "phfans");
  const q = String(pick?.quality || "240");
  const finalName = `${base}_${q}p.mp4`;

  let dl = pick?.proxy || pick?.proxy_inline || pick?.url || "";
  dl = absApi(dl);

  // fuerza download=1 si es /phfans/dl
  if (dl && /\/phfans\/dl\?/.test(dl) && !/[?&]download=1\b/.test(dl)) {
    dl += (dl.includes("?") ? "&" : "?") + "download=1";
  }

  if (!dl) throw new Error("No hay URL para descargar");

  const filePath = path.join(tmpDir, `ph-${Date.now()}-${q}.mp4`);

  const res = await axios.get(dl, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      apikey: API_KEY,
      "x-api-key": API_KEY,
      Authorization: `Bearer ${API_KEY}`,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "*/*",
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  // si sigue 401 / error
  if (res.status === 401) throw new Error("401: API Key no aceptada en /phfans/dl");
  if (res.status < 200 || res.status >= 300) throw new Error(`No se pudo descargar (HTTP ${res.status})`);

  // si el server devolvió JSON de error en vez de mp4
  const ct = String(res.headers?.["content-type"] || "");
  if (ct.includes("application/json")) {
    let txt = "";
    await new Promise((resolve) => {
      res.data.on("data", (c) => (txt += c.toString()));
      res.data.on("end", resolve);
      res.data.on("error", resolve);
    });
    try {
      const j = JSON.parse(txt);
      throw new Error(j?.message || j?.error || "Respuesta JSON de error");
    } catch {
      throw new Error("Respuesta JSON inesperada: " + txt.slice(0, 200));
    }
  }

  const writer = fs.createWriteStream(filePath);
  res.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  const size = fs.statSync(filePath).size;
  const sizeMB = mb(size);

  if (sizeMB > MAX_MB) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    throw new Error(`El video pesa ${sizeMB.toFixed(2)} MB, excede ${MAX_MB} MB.`);
  }

  return { filePath, fileName: finalName };
}

// 4) Enviar video (normal o documento)
async function sendPornVideo(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;

  const { chatId, title, pick, quotedBase } = job;
  const q = String(pick?.quality || "240");

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await conn.sendMessage(chatId, { text: "⏳ Espere, descargando su video..." }, { quoted: quotedBase });

    const { filePath, fileName } = await downloadPhVideoToTmp(pick, title);

    const caption =
      `✅ *PORNHUB DOWNLOADER*\n\n` +
      `📝 *Título:* ${title}\n` +
      `🎞️ *Calidad:* ${q}p\n\n` +
      `🔗 API: ${API_BASE}`;

    const buf = fs.readFileSync(filePath);

    await conn.sendMessage(
      chatId,
      {
        [asDocument ? "document" : "video"]: buf,
        mimetype: "video/mp4",
        fileName,
        caption,
      },
      { quoted: quotedBase }
    );

    try { fs.unlinkSync(filePath); } catch {}
    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Falló el envío: ${e.message || e}` }, { quoted: quotedBase });
    await react(conn, chatId, triggerMsg.key, "❌");
  } finally {
    job.isBusy = false;
  }
}

// ===== HANDLER =====
module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  let text = (args.join(" ") || "").trim();
  if (!text) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa:\n${pref}${command || "porn"} <url> [240|480|720|1080]\nEj: ${pref}${command || "porn"} https://es.pornhub.com/view_video.php?viewkey=XXXX 720` },
      { quoted: msg }
    );
  }

  const parts = text.split(/\s+/).filter(Boolean);
  const urlRaw = parts.find((p) => isUrl(p)) || parts[0];
  const url = normalizeUrl(urlRaw);
  const wantQ = pickQuality(parts);

  if (!isUrl(url) || !isPornhub(url)) {
    return conn.sendMessage(chatId, { text: "❌ Enlace inválido. Solo Pornhub (viewkey)." }, { quoted: msg });
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const result = await getPhfansInfo(url);
    const title = String(result?.title || "PHFans").slice(0, 120);

    const thumb =
      absApi(result?.thumbnail?.proxy_inline || result?.thumbnail?.proxy || result?.thumbnail?.url || "");

    const pick = pickVideoByQuality(result, wantQ);
    if (!pick) {
      await react(conn, chatId, msg.key, "❌");
      return conn.sendMessage(chatId, { text: "🚫 No se encontró video." }, { quoted: msg });
    }

    const caption =
      `✅ *PORNHUB DOWNLOADER*\n\n` +
      `📝 *Título:* ${title}\n` +
      `🎞️ *Calidad seleccionada:* ${String(pick?.quality || wantQ)}p\n\n` +
      `Elige cómo enviarlo:\n` +
      `👍 Video (normal)\n` +
      `❤️ Video como documento\n` +
      `— o responde: 1 = normal · 2 = documento\n\n` +
      `🔗 API: ${API_BASE}`;

    let preview;
    if (thumb && isUrl(thumb)) {
      preview = await conn.sendMessage(chatId, { image: { url: thumb }, caption }, { quoted: msg });
    } else {
      preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
    }

    pendingPORN[preview.key.id] = {
      chatId,
      title,
      pick,
      quotedBase: msg,
      previewKey: preview.key,
      isBusy: false,
    };

    setTimeout(() => {
      if (pendingPORN[preview.key.id]) delete pendingPORN[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

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

              await sendPornVideo(conn, job, emoji === "❤️", m);
              continue;
            }

            // Respuestas 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            if (ctx?.stanzaId && pendingPORN[ctx.stanzaId]) {
              const job = pendingPORN[ctx.stanzaId];
              if (job.chatId !== m.key.remoteJid) continue;

              const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
              if (body !== "1" && body !== "2") continue;
              if (job.isBusy) continue;

              await sendPornVideo(conn, job, body === "2", m);
            }
          } catch (e) {
            console.error("PORN listener error:", e);
          }
        }
      });
    }
  } catch (err) {
    console.error("Error PORN:", err);
    await conn.sendMessage(chatId, { text: `❌ Error: ${err.message}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["porn"];
module.exports.help = ["porn <url> [240|480|720|1080]"];
module.exports.tags = ["descargas"];
module.exports.register = true;
