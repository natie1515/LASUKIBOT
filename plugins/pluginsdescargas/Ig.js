// comandos/ig.js — Instagram video / imágenes con Neoxr API
// ✅ API: https://api.neoxr.eu/api/ig
// ✅ Soporta video e imágenes
// ✅ Botones directos: Normal / Documento / Todo / Todo Documento
// ✅ Reacciones: 👍 normal / ❤️ documento / 📦 todo / 📁 todo documento
// ✅ Respuestas: 1 normal / 2 documento / 3 todo / 4 todo documento
// ✅ Multiuso: No se borra al instante, dura 10 min

"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

const NEOXR_API_BASE = "https://api.neoxr.eu/api";
const NEOXR_API_KEY = "russellxz";

const MAX_MB = Number(process.env.MAX_MB || 200);
const MAX_ITEMS = Number(process.env.IG_MAX_ITEMS || 10);
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingIG = Object.create(null);

const mb = (n) => n / (1024 * 1024);

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

function botonesActivos() {
  const defaultCfg = {
    botones: true,
    updatedAt: null,
    updatedBy: null
  };

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
    await conn.sendMessage(chatId, {
      react: {
        text: emoji,
        key
      }
    });
  } catch {}
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isInstagramPageUrl(url = "") {
  const u = String(url || "");
  return /instagram\.com\/(p|reel|tv|stories)\//i.test(u);
}

function detectType(url = "", hint = "") {
  const h = String(hint || "").toLowerCase();
  const u = String(url || "").toLowerCase();

  if (h.includes("video") || h.includes("mp4") || /\.mp4(\?|#|$)/i.test(u)) {
    return "video";
  }

  if (
    h.includes("image") ||
    h.includes("photo") ||
    h.includes("jpg") ||
    h.includes("jpeg") ||
    h.includes("png") ||
    h.includes("webp") ||
    /\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(u)
  ) {
    return "image";
  }

  return "media";
}

function extFromMime(mimetype = "", type = "media", url = "") {
  const m = String(mimetype || "").toLowerCase();
  const u = String(url || "").toLowerCase();

  if (m.includes("video/mp4")) return "mp4";
  if (m.includes("image/jpeg")) return "jpg";
  if (m.includes("image/png")) return "png";
  if (m.includes("image/webp")) return "webp";

  const urlExt = u.match(/\.(mp4|jpg|jpeg|png|webp)(\?|#|$)/i);
  if (urlExt) return urlExt[1].toLowerCase() === "jpeg" ? "jpg" : urlExt[1].toLowerCase();

  if (type === "video") return "mp4";
  if (type === "image") return "jpg";

  return "bin";
}

function mimeFromType(type = "media", ext = "") {
  const e = String(ext || "").toLowerCase();

  if (type === "video" || e === "mp4") return "video/mp4";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (type === "image" || e === "jpg" || e === "jpeg") return "image/jpeg";

  return "application/octet-stream";
}

function addItem(out, item = {}) {
  const url = pickText(
    item.url,
    item.download,
    item.download_url,
    item.dl,
    item.link,
    item.src,
    item.source,
    item.media,
    item.video,
    item.video_url,
    item.image,
    item.image_url
  );

  if (!url || !isUrl(url)) return;
  if (isInstagramPageUrl(url)) return;

  const type = detectType(
    url,
    pickText(item.type, item.mime, item.mimetype, item.media_type, item.kind)
  );

  const thumbnail = pickText(
    item.thumbnail,
    item.thumb,
    item.cover,
    item.preview,
    item.image,
    item.image_url
  );

  if (!out.some(x => x.url === url)) {
    out.push({
      url,
      type,
      thumbnail,
      title: pickText(item.title, item.caption, item.description) || "Instagram"
    });
  }
}

function collectMediaItems(value, out = [], depth = 0) {
  if (!value || depth > 8) return out;

  if (typeof value === "string") {
    if (isUrl(value) && !isInstagramPageUrl(value)) {
      addItem(out, { url: value });
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMediaItems(item, out, depth + 1);
    }
    return out;
  }

  if (typeof value === "object") {
    addItem(out, value);

    for (const key of Object.keys(value)) {
      if (
        [
          "data",
          "result",
          "results",
          "media",
          "medias",
          "items",
          "item",
          "post",
          "posts",
          "images",
          "videos",
          "carousel",
          "resources",
          "download",
          "downloads"
        ].includes(String(key).toLowerCase())
      ) {
        collectMediaItems(value[key], out, depth + 1);
      }
    }

    for (const key of Object.keys(value)) {
      const v = value[key];

      if (typeof v === "object" && v !== null) {
        collectMediaItems(v, out, depth + 1);
      }
    }
  }

  return out;
}

function pickThumbnail(data, items = []) {
  return (
    pickText(
      data?.thumbnail,
      data?.thumb,
      data?.cover,
      data?.image,
      data?.result?.thumbnail,
      data?.result?.thumb,
      data?.result?.cover,
      data?.result?.image,
      data?.data?.thumbnail,
      data?.data?.thumb,
      data?.data?.cover,
      data?.data?.image
    ) ||
    items.find(x => x.thumbnail)?.thumbnail ||
    items.find(x => x.type === "image")?.url ||
    ""
  );
}

// API Neoxr
async function callNeoxrInstagram(url) {
  const r = await axios.get(`${NEOXR_API_BASE}/ig`, {
    timeout: 120000,
    params: {
      url,
      apikey: NEOXR_API_KEY
    },
    headers: {
      Accept: "application/json, */*"
    },
    validateStatus: () => true
  });

  let data = r.data;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data.trim());
    } catch {
      throw new Error("Respuesta no JSON de Neoxr");
    }
  }

  if (!data || typeof data !== "object") {
    throw new Error("Respuesta inválida de Neoxr");
  }

  const ok =
    data.status === true ||
    data.status === "true" ||
    data.ok === true ||
    data.success === true ||
    data.result ||
    data.data;

  if (!ok) {
    throw new Error(data.message || data.error || `HTTP ${r.status}`);
  }

  const root = data.result || data.data || data;
  const items = collectMediaItems(root, []);

  if (!items.length) {
    throw new Error("Neoxr no devolvió imágenes ni videos descargables");
  }

  const title =
    pickText(
      root.title,
      root.caption,
      root.description,
      data.title,
      data.caption,
      data.description
    ) || "Instagram";

  const thumbnail = pickThumbnail(data, items);

  return {
    title,
    thumbnail,
    items: items.slice(0, MAX_ITEMS)
  };
}

async function downloadMediaToTmp(srcUrl, filenameBase = "instagram", itemType = "media") {
  const tmp = path.resolve("./tmp");

  if (!fs.existsSync(tmp)) {
    fs.mkdirSync(tmp, { recursive: true });
  }

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
    Referer: "https://www.instagram.com/"
  };

  const res = await axios.get(srcUrl, {
    responseType: "stream",
    timeout: 180000,
    headers,
    maxRedirects: 5,
    validateStatus: () => true
  });

  if (res.status >= 400) {
    throw new Error(`HTTP_${res.status}`);
  }

  const mimetype = String(res.headers["content-type"] || "").split(";")[0].trim();
  const finalType = detectType(srcUrl, mimetype || itemType);
  const ext = extFromMime(mimetype, finalType, srcUrl);
  const filePath = path.join(tmp, `ig-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`);

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(filePath);
    res.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
    res.data.on("error", reject);
  });

  return {
    filePath,
    type: finalType,
    mimetype: mimetype || mimeFromType(finalType, ext),
    ext
  };
}

function buildOptionsCaption(items = []) {
  const total = items.length;
  const videos = items.filter(x => x.type === "video").length;
  const images = items.filter(x => x.type === "image").length;

  return `
╭━━━━━━━━━━━━━━━━╮
   ⚡ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 ⚡
╰━━━━━━━━━━━━━━━━╯

📦 *Contenido detectado:* ${total}
🎬 *Videos:* ${videos}
🖼️ *Imágenes:* ${images}

━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━

🟢 *Botones*
Toca una opción abajo:
   🎬 Normal
   📁 Documento
   📦 Todo
   🗂️ Todo Documento

🟡 *Reacciones*
   👍  →  Descargar primero normal
   ❤️  →  Descargar primero como documento
   📦  →  Descargar todo normal
   📁  →  Descargar todo documento

🔵 *Responder*
   *1* → primero normal
   *2* → primero documento
   *3* → todo normal
   *4* → todo documento

━━━━━━━━━━━━━━━━
🤖 *La Suki Bot*
🔗 *API:* Neoxr API
━━━━━━━━━━━━━━━━
`.trim();
}

// MAIN
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
${pref}${command} https://www.instagram.com/reel/XXXX/
${pref}${command} https://www.instagram.com/p/XXXX/`
      },
      { quoted: msg }
    );
  }

  text = normalizeIGUrl(text);

  if (!isUrl(text) || !isIG(text)) {
    return conn.sendMessage(
      chatId,
      {
        text: `❌ Enlace inválido.\nUsa: ${pref}${command} <url de Instagram>`
      },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const result = await callNeoxrInstagram(text);
    const items = result.items || [];

    if (!items.length) {
      await react(conn, chatId, msg.key, "❌");
      return conn.sendMessage(
        chatId,
        {
          text: "🚫 Ese enlace no tiene contenido descargable."
        },
        { quoted: msg }
      );
    }

    const title = result.title || "Instagram";
    const thumb = result.thumbnail || "";
    const caption = buildOptionsCaption(items);
    const usarBotones = botonesActivos();

    const buttons = [
      {
        text: "🎬 Normal",
        id: `${pref}ig_normal`
      },
      {
        text: "📁 Documento",
        id: `${pref}ig_doc`
      },
      {
        text: "📦 Todo",
        id: `${pref}ig_all`
      },
      {
        text: "🗂️ Todo Doc",
        id: `${pref}ig_alldoc`
      }
    ];

    let preview;

    if (usarBotones) {
      try {
        const payload = thumb && isUrl(thumb)
          ? {
              image: { url: thumb },
              caption,
              footer: "❦ La Suki Bot — Selecciona una opción ❦",
              buttons,
              headerType: 4
            }
          : {
              text: caption,
              footer: "❦ La Suki Bot — Selecciona una opción ❦",
              buttons,
              headerType: 1
            };

        preview = await conn.sendMessage(chatId, payload, { quoted: msg });
      } catch (e) {
        console.log("[ig] botones fallaron, usando fallback:", e.message);

        preview = await conn.sendMessage(
          chatId,
          thumb && isUrl(thumb)
            ? {
                image: { url: thumb },
                caption
              }
            : {
                text: caption
              },
          { quoted: msg }
        );
      }
    } else {
      preview = await conn.sendMessage(
        chatId,
        thumb && isUrl(thumb)
          ? {
              image: { url: thumb },
              caption
            }
          : {
              text: caption
            },
        { quoted: msg }
      );
    }

    pendingIG[preview.key.id] = {
      chatId,
      sourceUrl: text,
      title,
      thumbnail: thumb,
      items,
      quotedBase: msg,
      previewKey: preview.key,
      isBusy: false,
      _createdAt: Date.now()
    };

    setTimeout(() => {
      delete pendingIG[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    if (!conn._igNeoxrListener) {
      conn._igNeoxrListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages || []) {
          try {
            // REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingIG[reactKey.id];

              if (!job || job.chatId !== m.key.remoteJid) continue;

              if (emoji === "👍") {
                await processSend(conn, job, "normal", m);
              } else if (emoji === "❤️") {
                await processSend(conn, job, "document", m);
              } else if (emoji === "📦") {
                await processSend(conn, job, "all", m);
              } else if (emoji === "📁") {
                await processSend(conn, job, "alldoc", m);
              }

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

              if (!job) continue;

              await handleButtonSelection(conn, job, selectedId, m, pref);
              continue;
            }

            // RESPUESTAS CITADAS
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;

            if (replyTo && pendingIG[replyTo]) {
              const job = pendingIG[replyTo];

              if (job.chatId !== m.key.remoteJid) continue;

              const body = String(
                m.message?.conversation ||
                m.message?.extendedTextMessage?.text ||
                ""
              ).trim().toLowerCase();

              if (["1", "normal", "video", "imagen", "media"].includes(body)) {
                await processSend(conn, job, "normal", m);
              } else if (["2", "doc", "documento"].includes(body)) {
                await processSend(conn, job, "document", m);
              } else if (["3", "todo", "all"].includes(body)) {
                await processSend(conn, job, "all", m);
              } else if (["4", "tododoc", "alldoc", "todo documento"].includes(body)) {
                await processSend(conn, job, "alldoc", m);
              }
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

    await conn.sendMessage(
      chatId,
      {
        text: `❌ Error: ${s}`
      },
      { quoted: msg }
    );

    await react(conn, chatId, msg.key, "❌");
  }
};

async function handleButtonSelection(conn, job, selectedId, m, pref) {
  const id = String(selectedId || "").trim();

  if (id === `${pref}ig_normal` || id.endsWith("ig_normal")) {
    return processSend(conn, job, "normal", m);
  }

  if (id === `${pref}ig_doc` || id.endsWith("ig_doc")) {
    return processSend(conn, job, "document", m);
  }

  if (id === `${pref}ig_all` || id.endsWith("ig_all")) {
    return processSend(conn, job, "all", m);
  }

  if (id === `${pref}ig_alldoc` || id.endsWith("ig_alldoc")) {
    return processSend(conn, job, "alldoc", m);
  }
}

async function sendSingleItem(conn, job, item, asDocument, quotedBase, index = 1, total = 1) {
  const { chatId } = job;
  const title = job.title || item.title || "instagram";

  const downloaded = await downloadMediaToTmp(item.url, title, item.type);
  const { filePath, type, mimetype, ext } = downloaded;

  const sizeMB = mb(fs.statSync(filePath).size);

  if (sizeMB > MAX_MB) {
    try {
      fs.unlinkSync(filePath);
    } catch {}

    await conn.sendMessage(
      chatId,
      {
        text: `❌ Archivo muy pesado (${sizeMB.toFixed(2)} MB). Límite ${MAX_MB} MB.`
      },
      { quoted: quotedBase }
    );

    return;
  }

  const buf = fs.readFileSync(filePath);
  const tipoTexto = type === "video" ? "VIDEO" : type === "image" ? "IMAGEN" : "MEDIA";

  const finalCaption =
`╭━━━━━━━━━━━━━━━━╮
   ✅ 𝗜𝗡𝗦𝗧𝗔𝗚𝗥𝗔𝗠 ${tipoTexto}
╰━━━━━━━━━━━━━━━━╯

📦 *Archivo:* ${index}/${total}
📁 *Formato:* ${asDocument ? "Documento" : type === "video" ? "Video" : "Imagen"}
💾 *Tamaño:* ${sizeMB.toFixed(2)} MB

━━━━━━━━━━━━━━━━
🤖 *Bot:* La Suki Bot
🔗 *API:* Neoxr API
━━━━━━━━━━━━━━━━`;

  const fileName = `${safeFileName(title)}_${index}.${ext}`;

  const payload = {};

  if (asDocument) {
    payload.document = buf;
    payload.mimetype = mimetype || mimeFromType(type, ext);
    payload.fileName = fileName;
    payload.caption = finalCaption;
  } else if (type === "video") {
    payload.video = buf;
    payload.mimetype = mimetype || "video/mp4";
    payload.caption = finalCaption;
  } else if (type === "image") {
    payload.image = buf;
    payload.caption = finalCaption;
  } else {
    payload.document = buf;
    payload.mimetype = mimetype || "application/octet-stream";
    payload.fileName = fileName;
    payload.caption = finalCaption;
  }

  await conn.sendMessage(chatId, payload, { quoted: quotedBase });

  try {
    fs.unlinkSync(filePath);
  } catch {}
}

async function processSend(conn, job, mode, triggerMsg) {
  if (job.isBusy) return;

  job.isBusy = true;

  const { chatId, quotedBase } = job;

  try {
    const asDocument = mode === "document" || mode === "alldoc";
    const sendAll = mode === "all" || mode === "alldoc";

    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : sendAll ? "📦" : "🎬");

    await conn.sendMessage(
      chatId,
      {
        text: sendAll
          ? `⏳ Espere, descargando ${job.items.length} archivos de Instagram...`
          : "⏳ Espere, descargando su archivo de Instagram..."
      },
      { quoted: quotedBase }
    );

    const items = sendAll ? job.items.slice(0, MAX_ITEMS) : [job.items[0]];

    if (!items.length) {
      await conn.sendMessage(
        chatId,
        {
          text: "❌ No hay archivos para descargar."
        },
        { quoted: quotedBase }
      );
      return;
    }

    for (let i = 0; i < items.length; i++) {
      await sendSingleItem(
        conn,
        job,
        items[i],
        asDocument,
        quotedBase,
        i + 1,
        items.length
      );
    }

    await react(conn, chatId, triggerMsg.key, "✅");
  } catch (e) {
    await react(conn, chatId, triggerMsg.key, "❌");

    await conn.sendMessage(
      chatId,
      {
        text: `❌ Error enviando: ${e?.message || "unknown"}`
      },
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
