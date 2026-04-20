// commands/twitter.js — X/Twitter con Botones
// ✅ Botones: 🎬 Normal / 📁 Documento
// ✅ Reacciones: 👍 (Normal) / ❤️ (Documento) o Respuestas 1 / 2
// ✅ Respeta activoss.json (botones on/off)
// ✅ FIX 401: Descarga con Axios y Buffer si es necesario
// ✅ Multiuso: No se borra al instante (10 min activo)

"use strict";

const axios = require("axios");
const fs = require("fs");
const path = require("path");

// === Config API ===
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000;

// Archivo de configuración de botones
const ACTIVOSS_FILE = path.resolve("./activoss.json");

const pendingTW = Object.create(null);

// 🆕 Verifica si los botones están activos (crea archivo si no existe)
function botonesActivos() {
  const defaultCfg = { botones: true, updatedAt: null, updatedBy: null };
  if (!fs.existsSync(ACTIVOSS_FILE)) {
    try { fs.writeFileSync(ACTIVOSS_FILE, JSON.stringify(defaultCfg, null, 2)); } catch {}
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
  try { await conn.sendMessage(chatId, { react: { text: emoji, key } }); } catch {}
}

function isValidX(url) {
  const u = String(url || "").trim();
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(u)
      || /^https?:\/\/(www\.)?x\.com\/i\/status\/\d+/i.test(u);
}

// Obtener datos de la API
async function getTwitterFromSky(url) {
  const endpoint = `${API_BASE}/twitter`;

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
    try { data = JSON.parse(data.trim()); } catch { throw new Error("Respuesta no JSON del servidor"); }
  }

  const ok = data?.status === true || data?.status === "true";
  if (!ok) throw new Error(data?.message || data?.error || `HTTP ${http}`);

  const r = data.result || {};
  const best = r?.media?.best || r?.media?.items?.[0];
  if (!best) throw new Error("No se encontró media.");

  const direct = best?.url || best?.direct || best?.link || best?.media_url || null;
  const proxyInline = best?.proxy?.inline || null;
  const proxyDownload = best?.proxy?.download || proxyInline;

  if (!direct && !proxyInline) throw new Error("No se encontró enlace descargable.");

  const type = best.type === "video" ? "video" : "image";

  return {
    type,
    direct,
    proxyInline,
    proxyDownload,
    author: r.author || {},
    stats: r.stats || {},
    date: r.date || "",
    text: r.text || "",
    sourceUrl: r.url || url,
    thumbnail: best?.thumbnail || r?.thumbnail || null,
  };
}

async function fetchBuffer(url, useAuthHeaders) {
  const headers = useAuthHeaders
    ? { apikey: API_KEY, Authorization: `Bearer ${API_KEY}` }
    : {};

  const r = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: MAX_TIMEOUT,
    headers,
    validateStatus: () => true,
  });

  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  const ct = String(r.headers["content-type"] || "");
  return { buffer: Buffer.from(r.data), contentType: ct };
}

async function sendMedia(conn, job, asDocument, triggerMsg) {
  job.isBusy = true;
  const { chatId, type, direct, proxyInline, proxyDownload, caption, quotedBase } = job;

  const isVideo = type === "video";
  const mimetype = isVideo ? "video/mp4" : "image/jpeg";
  const ext = isVideo ? "mp4" : "jpg";

  try {
    await react(conn, chatId, triggerMsg.key, asDocument ? "📁" : "🎬");
    await conn.sendMessage(chatId, { text: "⏳ Espere, descargando su archivo..." }, { quoted: quotedBase });

    const urlTry = direct || proxyInline;
    if (urlTry) {
      try {
        if (asDocument) {
          await conn.sendMessage(
            chatId,
            { document: { url: urlTry }, mimetype, fileName: `twitter-${Date.now()}.${ext}`, caption },
            { quoted: quotedBase || triggerMsg }
          );
        } else {
          if (isVideo) {
            await conn.sendMessage(chatId, { video: { url: urlTry }, mimetype: "video/mp4", caption }, { quoted: quotedBase || triggerMsg });
          } else {
            await conn.sendMessage(chatId, { image: { url: urlTry }, caption }, { quoted: quotedBase || triggerMsg });
          }
        }
        await react(conn, chatId, triggerMsg.key, "✅");
        return;
      } catch (e) {
        // Falló URL directa, intentamos buffer
      }
    }

    let bufRes = null;
    if (direct) {
      try { bufRes = await fetchBuffer(direct, false); } catch {}
    }
    if (!bufRes && proxyDownload) {
      bufRes = await fetchBuffer(proxyDownload, true);
    }

    if (!bufRes) throw new Error("No se pudo descargar el archivo.");

    const mediaBuffer = bufRes.buffer;

    if (asDocument) {
      await conn.sendMessage(
        chatId,
        { document: mediaBuffer, mimetype, fileName: `twitter-${Date.now()}.${ext}`, caption },
        { quoted: quotedBase || triggerMsg }
      );
    } else {
      if (isVideo) {
        await conn.sendMessage(chatId, { video: mediaBuffer, mimetype: "video/mp4", caption }, { quoted: quotedBase || triggerMsg });
      } else {
        await conn.sendMessage(chatId, { image: mediaBuffer, caption }, { quoted: quotedBase || triggerMsg });
      }
    }

    await react(conn, chatId, triggerMsg.key, "✅");

  } catch (e) {
    console.error("TW Send Error:", e);
    await react(conn, chatId, triggerMsg.key, "❌");
    await conn.sendMessage(
      chatId,
      { text: `❌ Error enviando: ${e?.message || "unknown"}` },
      { quoted: quotedBase || triggerMsg }
    );
  } finally {
    job.isBusy = false;
  }
}

module.exports = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  const text = (args.join(" ") || "").trim();

  if (!text) {
    return conn.sendMessage(
      chatId,
      { text: `✳️ Usa:\n${pref}tw <enlace>\nEj: ${pref}tw https://x.com/user/status/123` },
      { quoted: msg }
    );
  }

  if (!isValidX(text)) {
    return conn.sendMessage(
      chatId,
      { text: `❌ Enlace inválido.\nUsa un link tipo:\nhttps://x.com/usuario/status/123` },
      { quoted: msg }
    );
  }

  try {
    await react(conn, chatId, msg.key, "⏳");

    const d = await getTwitterFromSky(text);

    const authorName = d.author?.name || "X";
    const username = d.author?.username ? `@${String(d.author.username).replace(/^@/, "")}` : "";
    const likes = Number(d.stats?.likes || 0);
    const replies = Number(d.stats?.replies || 0);
    const retweets = Number(d.stats?.retweets || 0);
    const tipo = d.type === "video" ? "Video" : "Imagen";

    const usarBotones = botonesActivos();

    // 🎨 Caption con diseño elegante según estado de botones
    const caption = usarBotones
      ? `
╭━━━━━━━━━━━━━━━━━╮
   ⚡ 𝗫 / 𝗧𝗪𝗜𝗧𝗧𝗘𝗥 𝗗𝗟
╰━━━━━━━━━━━━━━━━━╯

📀 *INFORMACIÓN*
┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
✦ *Tipo:* ${tipo}
✦ *Autor:* ${authorName} ${username}
✦ *Estadísticas:* ❤️ ${likes} · 💬 ${replies} · 🔁 ${retweets}
${d.date ? `✦ *Fecha:* ${d.date}` : ""}

━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━

🟢 *OPCIÓN 1 — Botones*
Toca un botón abajo del mensaje:
   🎬 *Normal*
   📁 *Documento*

🟡 *OPCIÓN 2 — Reaccionar*
Reacciona con un emoji:
   👍  →  Enviar normal
   ❤️  →  Enviar como documento

🔵 *OPCIÓN 3 — Responder número*
Cita este mensaje y escribe:
   *1*  →  Enviar normal
   *2*  →  Enviar como documento

━━━━━━━━━━━━━━━━━━━━
🤖 *Bot:* La Suki Bot
🔗 *API:* ${API_BASE}`.trim()
      : `
╭━━━━━━━━━━━━━━━━━╮
   ⚡ 𝗫 / 𝗧𝗪𝗜𝗧𝗧𝗘𝗥 𝗗𝗟
╰━━━━━━━━━━━━━━━━━╯

📀 *INFORMACIÓN*
┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
✦ *Tipo:* ${tipo}
✦ *Autor:* ${authorName} ${username}
✦ *Estadísticas:* ❤️ ${likes} · 💬 ${replies} · 🔁 ${retweets}
${d.date ? `✦ *Fecha:* ${d.date}` : ""}

━━━━━━━━━━━━━━━━━━━━
 *📥 CÓMO DESCARGAR*
━━━━━━━━━━━━━━━━━━━━

🟡 *OPCIÓN 1 — Reaccionar*
Reacciona con un emoji:
   👍  →  Enviar normal
   ❤️  →  Enviar como documento

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe:
   *1*  →  Enviar normal
   *2*  →  Enviar como documento

━━━━━━━━━━━━━━━━━━━━
🤖 *Bot:* La Suki Bot
🔗 *API:* ${API_BASE}`.trim();

    // Botones nativos (solo 2 opciones)
    const nativeFlowButtons = [
      { text: "🎬 Normal",    id: `${pref}tw_normal` },
      { text: "📁 Documento", id: `${pref}tw_documento` },
    ];

    let preview;
    if (usarBotones) {
      try {
        preview = await conn.sendMessage(chatId, {
          text: caption,
          footer: "❦ La Suki Bot — Selecciona una opción ❦",
          buttons: nativeFlowButtons,
        }, { quoted: msg });
      } catch (e) {
        console.log("[tw] botones fallaron, fallback:", e.message);
        preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
      }
    } else {
      // Botones desactivados
      preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
    }

    pendingTW[preview.key.id] = {
      chatId,
      type: d.type,
      direct: d.direct,
      proxyInline: d.proxyInline,
      proxyDownload: d.proxyDownload,
      caption:
`✅ 𝗧𝘄𝗶𝘁𝘁𝗲𝗿/𝗫 — ${tipo}

✦ 𝗔𝘂𝘁𝗼𝗿: ${authorName} ${username}

🤖 𝗕𝗼𝘁: La Suki Bot
🔗 𝗔𝗣𝗜: ${API_BASE}`,
      quotedBase: msg,
      previewKey: preview.key,
      _createdAt: Date.now(),
      isBusy: false,
    };

    setTimeout(() => {
      if (pendingTW[preview.key.id]) delete pendingTW[preview.key.id];
    }, 10 * 60 * 1000);

    await react(conn, chatId, msg.key, "✅");

    if (!conn._twInteractiveListener) {
      conn._twInteractiveListener = true;

      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          try {
            // A) REACCIONES
            if (m.message?.reactionMessage) {
              const { key: reactKey, text: emoji } = m.message.reactionMessage;
              const job = pendingTW[reactKey.id];

              if (!job) continue;
              if (job.chatId !== m.key.remoteJid) continue;
              if (emoji !== "👍" && emoji !== "❤️") continue;

              if (job.isBusy) continue;
              await sendMedia(conn, job, emoji === "❤️", m);
              continue;
            }

            // B) BOTONES / MENÚ INTERACTIVO
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

              if (!selectedId) continue;
              const id = String(selectedId).trim();

              const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
              let job = null;
              if (ctxQuoted && pendingTW[ctxQuoted]) {
                job = pendingTW[ctxQuoted];
              } else {
                const jobs = Object.values(pendingTW)
                  .filter(j => j.chatId === m.key.remoteJid)
                  .sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
                if (jobs.length > 0) job = jobs[0];
              }

              if (!job || job.isBusy) continue;

              if (id.endsWith("tw_normal")) {
                await sendMedia(conn, job, false, m);
                continue;
              }
              if (id.endsWith("tw_documento")) {
                await sendMedia(conn, job, true, m);
                continue;
              }
            }

            // C) RESPUESTAS 1/2
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const replyTo = ctx?.stanzaId;
            if (replyTo && pendingTW[replyTo]) {
              const job = pendingTW[replyTo];
              if (job.chatId !== m.key.remoteJid) continue;

              const body = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
              if (body !== "1" && body !== "2") continue;

              if (job.isBusy) continue;
              await sendMedia(conn, job, body === "2", m);
            }
          } catch (e) {
            console.error("Twitter listener error:", e?.message || e);
          }
        }
      });
    }
  } catch (err) {
    console.error("❌ Error Twitter:", err?.message || err);
    await conn.sendMessage(chatId, { text: `❌ Error: ${err?.message || "unknown"}` }, { quoted: msg });
    await react(conn, chatId, msg.key, "❌");
  }
};

module.exports.command = ["twitter", "tw", "xdl", "x"];
module.exports.help = ["tw <url>"];
module.exports.tags = ["descargas"];
module.exports.register = true;
