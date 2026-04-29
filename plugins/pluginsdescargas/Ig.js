// comandos/ig.js — Instagram VIDEO / IMAGEN con Neoxr API
// ✅ API: https://api.neoxr.eu/api/ig
// ✅ Botones directos si activoss.json -> botones !== false
// ✅ Si botones OFF: usa reacciones 👍 ❤️ o responde 1 / 2
// ✅ Soporta imagen, video y carrusel
// ✅ Branding La Suki Bot

"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

const NEOXR_BASE = "https://api.neoxr.eu/api";
const NEOXR_KEY = process.env.NEOXR_KEY || "russellxz";

const MAX_MB = Number(process.env.MAX_MB || 200);
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingIG = Object.create(null);

function mb(n) {
  return n / (1024 * 1024);
}

function isIG(u = "") {
  return /(instagram\.com|instagr\.am)/i.test(String(u || ""));
}

function isUrl(u = "") {
  return /^https?:\/\//i.test(String(u || ""));
}

function normalizeIGUrl(input = "") {
  let u = String(input || "").trim();
  u = u.replace(/^<|>$/g, "").trim();

  if (/^(www\.)?instagram\.com\//i.test(u) || /^instagr\.am\//i.test(u)) {
    u = "https://" + u.replace(/^\/+/, "");
  }

  return u;
}

function safeFileName(name = "instagram") {
  return (
    String(name || "instagram")
      .slice(0, 80)
      .replace(/[^A-Za-z0-9_\-. ]+/g, "_")
      .replace(/\s+/g, "_")
      .trim() || "instagram"
  );
}

function ensureTmp() {
  const tmp = path.resolve("./tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function botonesActivos() {
  const defaultCfg = { botones: true, updatedAt: null, updatedBy: null };

  if (!fs.existsSync(ACTIVOSS_FILE)) {
    try {
      fs.writeFileSync(ACTIVOSS_FILE, JSON.stringify(defaultCfg, null, 2));
    } catch {}
    return true;
  }

  try {
    const cfg = JSON.parse(fs.readFileSync(ACTIVOSS_FILE, "utf-8"));
    return cfg.botones !== false;
  } catch {
    return true;
  }
}

async function react(conn, chatId, key, emoji) {
  try {
    await conn.sendMessage(chatId, { react: { text: emoji, key } });
  } catch {}
}

function guessType(url = "", mime = "") {
  const u = String(url || "").toLowerCase();
  const m = String(mime || "").toLowerCase();

  if (m.startsWith("video/") || /\.(mp4|mov|webm)(\?|#|$)/i.test(u)) return "video";
  if (m.startsWith("image/") || /\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(u)) return "image";

  return "video";
}

function guessMime(type = "video", url = "") {
  const u = String(url || "").toLowerCase();

  if (type === "image") {
    if (/\.png(\?|#|$)/i.test(u)) return "image/png";
    if (/\.webp(\?|#|$)/i.test(u)) return "image/webp";
    return "image/jpeg";
  }

  return "video/mp4";
}

function getExt(type = "video", mime = "", url = "") {
  const u = String(url || "").toLowerCase();
  const m = String(mime || "").toLowerCase();

  if (type === "image") {
    if (m.includes("png") || /\.png(\?|#|$)/i.test(u)) return "png";
    if (m.includes("webp") || /\.webp(\?|#|$)/i.test(u)) return "webp";
    return "jpg";
  }

  return "mp4";
}

// ✅ API NEOXR
async function callNeoxrInstagram(url) {
  const endpoint = `${NEOXR_BASE}/ig`;

  const r = await axios.get(endpoint, {
    params: {
      url,
      apikey: NEOXR_KEY
    },
    timeout: 90000,
    headers: {
      Accept: "application/json, */*",
      "User-Agent": "Mozilla/5.0"
    },
    validateStatus: () => true
  });

  let data = r.data;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw new Error("Respuesta no JSON del servidor");
    }
  }

  const ok =
    data?.status === true ||
    data?.status === "true" ||
    data?.ok === true ||
    data?.success === true ||
    data?.code === 200;

  if (!ok) {
    throw new Error(data?.message || data?.error || `HTTP ${r.status}`);
  }

  return data;
}

function pushItem(out, value, fallbackType = "") {
  if (!value) return;

  if (typeof value === "string") {
    if (!isUrl(value)) return;

    const type = fallbackType || guessType(value);
    const mime = guessMime(type, value);

    out.push({
      url: value,
      type,
      mime
    });
    return;
  }

  if (typeof value !== "object") return;

  const possibleUrl =
    value.url ||
    value.dl ||
    value.link ||
    value.download ||
    value.downloadUrl ||
    value.download_url ||
    value.media ||
    value.src ||
    value.video ||
    value.image ||
    value.thumbnail ||
    value.display_url ||
    "";

  if (!possibleUrl || !isUrl(possibleUrl)) return;

  let type =
    String(value.type || value.media_type || value.mime || "").toLowerCase();

  if (type.includes("video")) type = "video";
  else if (type.includes("image") || type.includes("photo")) type = "image";
  else if (value.video) type = "video";
  else if (value.image || value.display_url) type = "image";
  else type = fallbackType || guessType(possibleUrl, value.mime);

  const mime = value.mime || value.mimetype || guessMime(type, possibleUrl);

  out.push({
    url: possibleUrl,
    type,
    mime
  });
}

function extractItems(apiData) {
  const out = [];

  const root =
    apiData?.result ||
    apiData?.data ||
    apiData?.res ||
    apiData;

  const containers = [
    root?.media,
    root?.medias,
    root?.items,
    root?.urls,
    root?.url,
    root?.download,
    root?.downloads,
    root?.result,
    root?.data,
    root
  ];

  for (const c of containers) {
    if (!c) continue;

    if (Array.isArray(c)) {
      for (const item of c) pushItem(out, item);
      continue;
    }

    if (typeof c === "string") {
      pushItem(out, c);
      continue;
    }

    if (typeof c === "object") {
      if (Array.isArray(c.items)) {
        for (const item of c.items) pushItem(out, item);
      }

      if (Array.isArray(c.media)) {
        for (const item of c.media) pushItem(out, item);
      }

      if (Array.isArray(c.medias)) {
        for (const item of c.medias) pushItem(out, item);
      }

      pushItem(out, c);
      pushItem(out, c.video, "video");
      pushItem(out, c.image, "image");
      pushItem(out, c.url);
      pushItem(out, c.download);
      pushItem(out, c.downloadUrl);
      pushItem(out, c.download_url);
    }
  }

  const unique = [];
  const seen = new Set();

  for (const item of out) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
  }

  return unique;
}

function getTitle(apiData) {
  const root = apiData?.result || apiData?.data || apiData;

  return (
    root?.title ||
    root?.caption ||
    root?.description ||
    root?.username ||
    "Instagram"
  );
}

function getThumbnail(apiData, items = []) {
  const root = apiData?.result || apiData?.data || apiData;

  const thumb =
    root?.thumbnail ||
    root?.thumb ||
    root?.image ||
    root?.cover ||
    root?.display_url ||
    "";

  if (thumb && isUrl(thumb)) return thumb;

  const firstImage = items.find(x => x.type === "image" && isUrl(x.url));
  if (firstImage) return firstImage.url;

  return "";
}

async function downloadToTmp(item, filenameBase = "instagram") {
  const tmp = ensureTmp();

  const type = item.type || guessType(item.url, item.mime);
  const mime = item.mime || guessMime(type, item.url);
  const ext = getExt(type, mime, item.url);

  const filePath = path.join(tmp, `ig-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);

  const res = await axios.get(item.url, {
    responseType: "stream",
    timeout: 180000,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*"
    },
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (res.status >= 400) {
    throw new Error(`HTTP_${res.status}`);
  }

  await streamPipe(res.data, fs.createWriteStream(filePath));

  return {
    filePath,
    type,
    mime,
    ext,
    fileName: `${safeFileName(filenameBase)}.${ext}`
  };
}

// 3. HANDLER PRINCIPAL
module.exports = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  let text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      {
        text:
`✳️ Usa:
${pref}${command} <enlace IG>

Ej:
${pref}${command} https://www.instagram.com/reel/XXXX/`
      },
      { quoted: msg }
    );
  }

  text = normalizeIGUrl(text);

  if (!isUrl(text) || !isIG(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa: ${pref}${command} <url de Instagram>` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const apiData = await callNeoxrInstagram(text);
    const items = extractItems(apiData);

    if (!items.length) {
      await react(conn, chatId, msg.key, "❌");
      return conn.sendMessage(
        chatId,
        { text: "🚫 No encontré imagen o video descargable en ese enlace." },
        { quoted: msg }
      );
    }

    const title = getTitle(apiData);
    const thumb = getThumbnail(apiData, items);
    const usarBotones = botonesActivos();

    const caption = usarBotones
      ? `
╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 ⚡
╰━━━━━━━━━━━━━━━━╯

━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━

🟢 *OPCIÓN 1 — Botones*
Toca un botón abajo del mensaje:

🎬 *Normal*
📄 *Documento*

━━━━━━━━━━━━━━━━
🤖 *La Suki Bot*
🔗 *API:* ${NEOXR_BASE}
━━━━━━━━━━━━━━━━
`.trim()
      : `
╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 ⚡
╰━━━━━━━━━━━━━━━━╯

━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━

🟡 *OPCIÓN 1 — Reaccionar*
👍  →  Enviar normal
❤️  →  Enviar como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:

*1* → Normal
*2* → Documento

━━━━━━━━━━━━━━━━
🤖 *La Suki Bot*
🔗 *API:* ${NEOXR_BASE}
━━━━━━━━━━━━━━━━
`.trim();

    const nativeFlowButtons = [
      { text: "🎬 Normal", id: `${pref}ig_normal` },
      { text: "📄 Documento", id: `${pref}ig_doc` }
    ];

    let preview;

    if (usarBotones) {
      try {
        preview = await conn.sendMessage(
          chatId,
          {
            image: thumb && isUrl(thumb) ? { url: thumb } : undefined,
            caption,
            footer: "❦ La Suki Bot — Selecciona una opción ❦",
            buttons: nativeFlowButtons,
            headerType: 4
          },
          { quoted: msg }
        );
      } catch {
        preview = await conn.sendMessage(
          chatId,
          thumb && isUrl(thumb)
            ? { image: { url: thumb }, caption }
            : { text: caption },
          { quoted: msg }
        );
      }
    } else {
      preview = await conn.sendMessage(
        chatId,
        thumb && isUrl(thumb)
          ? { image: { url: thumb }, caption }
          : { text: caption },
        { quoted: msg }
      );
    }

    pendingIG[preview.key.id] = {
      chatId,
      items,
      title,
      quotedBase: msg,
      previewKey: preview.key,
      isBusy: false,
      _createdAt: Date.now()
    };

    setTimeout(() => {
      delete pendingIG[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    if (!conn._igListener) {
      conn._igListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages || []) {
          try {
            // REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingIG[reactKey.id];

              if (!job || job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;
              if (job.isBusy) continue;

              const asDoc = emoji === "❤️";
              await processSend(conn, job, asDoc, m);
              continue;
            }

            // BOTONES
            const interactiveReply =
              m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
              m.message?.buttonsResponseMessage ||
              m.message?.templateButtonReplyMessage ||
              m.message?.listResponseMessage ||
              null;

            if (interactiveReply) {
              let selectedId = "";

              if (m.message?.buttonsResponseMessage?.selectedButtonId) {
                selectedId = m.message.buttonsResponseMessage.selectedButtonId;
              } else if (m.message?.templateButtonReplyMessage?.selectedId) {
                selectedId = m.message.templateButtonReplyMessage.selectedId;
              } else if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
                selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
              } else if (interactiveReply?.paramsJson) {
                try {
                  const params = JSON.parse(interactiveReply.paramsJson);
                  selectedId = params.id || "";
                } catch {}
              } else if (interactiveReply?.body?.text) {
                selectedId = interactiveReply.body.text;
              }

              if (!selectedId || !selectedId.includes("ig_")) continue;

              const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
              let job = null;

              if (ctxQuoted && pendingIG[ctxQuoted]) {
                job = pendingIG[ctxQuoted];
              } else {
                const jobsInChat = Object.entries(pendingIG)
                  .filter(([, j]) => j.chatId === m.key.remoteJid)
                  .sort(([, a], [, b]) => (b._createdAt || 0) - (a._createdAt || 0));

                if (jobsInChat.length > 0) job = jobsInChat[0][1];
              }

              if (!job || job.isBusy) continue;

              if (selectedId.endsWith("ig_normal")) {
                await processSend(conn, job, false, m);
              }

              if (selectedId.endsWith("ig_doc")) {
                await processSend(conn, job, true, m);
              }

              continue;
            }

            // RESPUESTAS CITADAS
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            if (replyTo && pendingIG[replyTo]) {
              const job = pendingIG[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;
              if (job.isBusy) continue;

              const body = String(
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                ""
              ).trim().toLowerCase();

              if (body !== "1" && body !== "2") continue;

              const asDoc = body === "2";
              await processSend(conn, job, asDoc, m);
            }
          } catch (e) {
            console.error("IG listener error:", e);
          }
        }
      });
    }
  } catch (err) {
    const s = String(err?.message || "");
    console.error("❌ IG error:", s);
    await conn.sendMessage(chatId, { text: `❌ Error: ${s}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

async function processSend(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;

  const { chatId, items, quotedBase } = job;
  const title = job.title || "instagram";

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📄" : "🎬");

    await conn.sendMessage(
      chatId,
      {
        text: asDocument
          ? "⏳ Espere, descargando como documento..."
          : "⏳ Espere, descargando su contenido..."
      },
      { quoted: quotedBase }
    );

    let sent = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      const fileData = await downloadToTmp(item, `${title}_${i + 1}`);
      const sizeMB = mb(fs.statSync(fileData.filePath).size);

      if (sizeMB > MAX_MB) {
        try { fs.unlinkSync(fileData.filePath); } catch {}

        await conn.sendMessage(
          chatId,
          {
            text: `❌ Archivo muy pesado (${sizeMB.toFixed(2)} MB). Límite ${MAX_MB} MB.`
          },
          { quoted: quotedBase }
        );

        continue;
      }

      const buf = fs.readFileSync(fileData.filePath);

      const finalCaption =
`✅ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 𝗗𝗘𝗦𝗖𝗔𝗥𝗚𝗔𝗗𝗢

📦 *Tipo:* ${fileData.type === "image" ? "Imagen" : "Video"}
💾 *Tamaño:* ${sizeMB.toFixed(2)} MB
🤖 *Bot:* La Suki Bot
🔗 *API:* ${NEOXR_BASE}`;

      if (asDocument) {
        await conn.sendMessage(
          chatId,
          {
            document: buf,
            mimetype: fileData.mime,
            fileName: fileData.fileName,
            caption: finalCaption
          },
          { quoted: quotedBase }
        );
      } else {
        await conn.sendMessage(
          chatId,
          fileData.type === "image"
            ? {
                image: buf,
                mimetype: fileData.mime,
                caption: finalCaption
              }
            : {
                video: buf,
                mimetype: fileData.mime,
                fileName: fileData.fileName,
                caption: finalCaption
              },
          { quoted: quotedBase }
        );
      }

      sent++;

      try { fs.unlinkSync(fileData.filePath); } catch {}
    }

    if (!sent) {
      await conn.sendMessage(
        chatId,
        { text: "❌ No se pudo enviar ningún archivo." },
        { quoted: quotedBase }
      );
    } else {
      await react(conn, chatId, triggerMsg.key, "✅");
    }
  } catch (e) {
    await react(conn, chatId, triggerMsg.key, "❌");

    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase }
    );
  } finally {
    job.isBusy = false;
  }
}

module.exports.command = ["instagram", "ig"];
module.exports.help = ["instagram <url>", "ig <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
