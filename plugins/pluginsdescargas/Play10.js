// commands/play.js — YouTube Play (Buscador + Descarga)
// ✅ Publicidad agregada en el caption del video final
// ✅ Soporta Calidad, Reacciones, Respuestas Citadas
// ✅ NUEVO: Menú interactivo tipo lista (nativeFlow) + botones

"use strict";

const axios = require("axios");
const yts = require("yt-search");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { pipeline } = require("stream");
const streamPipe = promisify(pipeline);

// ==== CONFIG DE TU API ====
const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "Russellxz";

// Defaults
const DEFAULT_VIDEO_QUALITY = "360";
const DEFAULT_AUDIO_FORMAT = "mp3";
const MAX_MB = 200;

// Calidades válidas
const VALID_QUALITIES = new Set(["144", "240", "360", "720", "1080", "1440", "4k"]);

// Almacena tareas pendientes por previewMessageId
const pending = {};

// ---------- utils ----------
function safeName(name = "file") {
  return (
    String(name)
      .slice(0, 90)
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file"
  );
}

function fileSizeMB(filePath) {
  const b = fs.statSync(filePath).size;
  return b / (1024 * 1024);
}

function ensureTmp() {
  const tmp = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function extractQualityFromText(input = "") {
  const t = String(input || "").toLowerCase();
  if (t.includes("4k")) return "4k";
  const m = t.match(/\b(144|240|360|720|1080|1440)\s*p?\b/);
  if (m && VALID_QUALITIES.has(m[1])) return m[1];
  return "";
}

function splitQueryAndQuality(rawText = "") {
  const t = String(rawText || "").trim();
  if (!t) return { query: "", quality: "" };

  const parts = t.split(/\s+/);
  const last = (parts[parts.length - 1] || "").toLowerCase();

  let q = "";
  if (last === "4k") q = "4k";
  else {
    const m = last.match(/^(144|240|360|720|1080|1440)p?$/i);
    if (m) q = m[1];
  }

  if (q) {
    parts.pop();
    return { query: parts.join(" ").trim(), quality: q };
  }
  return { query: t, quality: "" };
}

function isApiUrl(url = "") {
  try {
    const u = new URL(url);
    const b = new URL(API_BASE);
    return u.host === b.host;
  } catch {
    return false;
  }
}

async function downloadToFile(url, filePath) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
  };

  if (isApiUrl(url)) headers["apikey"] = API_KEY;

  const res = await axios.get(url, {
    responseType: "stream",
    timeout: 180000,
    headers,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    throw new Error(`HTTP_${res.status}`);
  }

  await streamPipe(res.data, fs.createWriteStream(filePath));
  return filePath;
}

// ---------- API ----------
async function callYoutubeResolve(videoUrl, { type, quality, format }) {
  const endpoint = `${API_BASE}/youtube/resolve`;

  const body =
    type === "video"
      ? { url: videoUrl, type: "video", quality: quality || DEFAULT_VIDEO_QUALITY }
      : { url: videoUrl, type: "audio", format: format || DEFAULT_AUDIO_FORMAT };

  const r = await axios.post(endpoint, body, {
    timeout: 120000,
    headers: {
      "Content-Type": "application/json",
      apikey: API_KEY,
      Accept: "application/json, */*",
    },
    validateStatus: () => true,
  });

  const data = typeof r.data === "object" ? r.data : null;
  if (!data) throw new Error("Respuesta no JSON del servidor");

  const ok = data.status === true || data.status === "true" || data.ok === true || data.success === true;
  if (!ok) throw new Error(data.message || data.error || "Error en la API");

  const result = data.result || data.data || data;
  if (!result?.media) throw new Error("API sin media");

  let dl = result.media.dl_download || "";
  if (dl && typeof dl === "string" && dl.startsWith("/")) dl = API_BASE + dl;

  const direct = result.media.direct || "";

  return {
    title: result.title || "YouTube",
    thumbnail: result.thumbnail || "",
    picked: result.picked || {},
    dl_download: dl,
    direct,
  };
}

// ---------- main ----------
module.exports = async (msg, { conn, text }) => {
  const pref = global.prefixes?.[0] || ".";
  const { query, quality } = splitQueryAndQuality(text);

  if (!query) {
    return conn.sendMessage(
      msg.key.remoteJid,
      { text: `✳️ Usa:\n${pref}play <término> [calidad]\nEj: *${pref}play* bad bunny diles 720` },
      { quoted: msg }
    );
  }

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

  const res = await yts(query);
  const video = res.videos?.[0];
  if (!video) {
    return conn.sendMessage(msg.key.remoteJid, { text: "❌ Sin resultados." }, { quoted: msg });
  }

  const { url: videoUrl, title, timestamp: duration, views, author, thumbnail } = video;
  const viewsFmt = (views || 0).toLocaleString();
  const chosenQuality = VALID_QUALITIES.has(quality) ? quality : DEFAULT_VIDEO_QUALITY;
  const qualityLabel = chosenQuality === "4k" ? "4K" : `${chosenQuality}p`;

  const caption = `
❦𝑳𝑨 𝑺𝑼𝑲𝑰 𝑩𝑶𝑻❦

📀 𝙸𝚗𝚏𝚘:
❥ 𝑻𝒊𝒕𝒖𝒍𝒐: ${title}
❥ 𝑫𝒖𝒓𝒂𝒄𝒊𝒐𝒏: ${duration}
❥ 𝑽𝒊𝒔𝒕𝒂𝒔: ${viewsFmt}
❥ 𝑨𝒖𝒕𝒐𝒓: ${author?.name || author || "Desconocido"}
❥ 𝑳𝒊𝒏𝒌: ${videoUrl}

⚙️ Calidad video seleccionada: ${qualityLabel} (default: 360p)
🎵 Audio: MP3

📥 Opciones rápidas:
☛ 👍 Audio MP3     (1 / audio)
☛ ❤️ Video         (2 / video)  -> usa ${qualityLabel}
☛ 📄 Audio Doc     (4 / audiodoc)
☛ 📁 Video Doc     (3 / videodoc)

💡 Tip: También puedes responder:
- "video 720" o "2 720" (cambia calidad)
- "audio" (siempre mp3)

👇 *O usa el menú abajo* 👇

❦𝑳𝑨 𝑺𝑼𝑲𝑰 𝑩𝑶𝑻❦
`.trim();

  // ====== MENÚ INTERACTIVO (lista desplegable + botones) ======
  // Estructura compatible con itsliaaa/baileys
  const nativeFlowButtons = [
    {
      text: "📥 Menú de descarga",
      sections: [
        {
          title: "🎵 AUDIO",
          highlight_label: "MP3",
          rows: [
            {
              header: "",
              title: "🎵 Audio MP3",
              description: "Descargar como nota de audio (mp3)",
              id: `${pref}play_audio`,
            },
            {
              header: "",
              title: "📄 Audio como Documento",
              description: "Descargar como archivo mp3",
              id: `${pref}play_audiodoc`,
            },
          ],
        },
        {
          title: "🎬 VIDEO",
          highlight_label: qualityLabel,
          rows: [
            {
              header: "",
              title: `🎬 Video ${qualityLabel}`,
              description: `Descargar como video normal`,
              id: `${pref}play_video`,
            },
            {
              header: "",
              title: `📁 Video como Documento ${qualityLabel}`,
              description: `Descargar como archivo mp4`,
              id: `${pref}play_videodoc`,
            },
          ],
        },
        {
          title: "⚙️ OTRAS CALIDADES",
          rows: [
            { header: "", title: "🎬 Video 144p", description: "Muy liviano", id: `${pref}play_video_144` },
            { header: "", title: "🎬 Video 240p", description: "Liviano", id: `${pref}play_video_240` },
            { header: "", title: "🎬 Video 360p", description: "Estándar", id: `${pref}play_video_360` },
            { header: "", title: "🎬 Video 720p", description: "HD", id: `${pref}play_video_720` },
            { header: "", title: "🎬 Video 1080p", description: "Full HD", id: `${pref}play_video_1080` },
            { header: "", title: "🎬 Video 4K", description: "Ultra HD (pesado)", id: `${pref}play_video_4k` },
          ],
        },
      ],
    },
  ];

  let preview;
  try {
    // Intento 1: enviar con menú interactivo nativo (itsliaaa fork)
    preview = await conn.sendMessage(
      msg.key.remoteJid,
      {
        image: { url: thumbnail },
        caption,
        footer: "❦ La Suki Bot — Selecciona una opción ❦",
        buttons: nativeFlowButtons,
        headerType: 4,
      },
      { quoted: msg }
    );
  } catch (e) {
    console.log("[play] menú nativo falló, usando fallback:", e.message);
    // Fallback: mensaje normal con imagen (funciona en cualquier Baileys)
    preview = await conn.sendMessage(
      msg.key.remoteJid,
      { image: { url: thumbnail }, caption },
      { quoted: msg }
    );
  }

  pending[preview.key.id] = {
    chatId: msg.key.remoteJid,
    videoUrl,
    title,
    thumbnail,
    commandMsg: msg,
    videoQuality: chosenQuality,
  };

  await conn.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });

  // ====== listener único ======
  if (!conn._playproListener) {
    conn._playproListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        // 1) REACCIONES
        if (m.message?.reactionMessage) {
          const { key: reactKey, text: emoji } = m.message.reactionMessage;
          const job = pending[reactKey.id];
          if (job) await handleDownload(conn, job, emoji, job.commandMsg);
          continue;
        }

        // 2) RESPUESTAS DEL MENÚ INTERACTIVO (listas nativas)
        try {
          const interactiveReply =
            m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
            m.message?.listResponseMessage ||
            m.message?.buttonsResponseMessage ||
            m.message?.templateButtonReplyMessage ||
            null;

          if (interactiveReply) {
            // Obtener el ID seleccionado según el tipo de respuesta
            let selectedId = "";

            if (m.message?.listResponseMessage?.singleSelectReply?.selectedRowId) {
              selectedId = m.message.listResponseMessage.singleSelectReply.selectedRowId;
            } else if (m.message?.buttonsResponseMessage?.selectedButtonId) {
              selectedId = m.message.buttonsResponseMessage.selectedButtonId;
            } else if (m.message?.templateButtonReplyMessage?.selectedId) {
              selectedId = m.message.templateButtonReplyMessage.selectedId;
            } else if (interactiveReply?.paramsJson) {
              try {
                const params = JSON.parse(interactiveReply.paramsJson);
                selectedId = params.id || "";
              } catch {}
            } else if (interactiveReply?.body?.text) {
              selectedId = interactiveReply.body.text;
            }

            if (!selectedId) continue;

            // Identificar qué mensaje original corresponde
            // Como el menú no devuelve stanzaId del original, buscamos el job más reciente del usuario
            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;
            let jobKey = null;

            if (ctxQuoted && pending[ctxQuoted]) {
              job = pending[ctxQuoted];
              jobKey = ctxQuoted;
            } else {
              // Buscar el último job creado en el mismo chat
              const jobsInChat = Object.entries(pending)
                .filter(([, j]) => j.chatId === m.key.remoteJid)
                .sort(([, a], [, b]) => (b._createdAt || 0) - (a._createdAt || 0));
              if (jobsInChat.length > 0) {
                [jobKey, job] = jobsInChat[0];
              }
            }

            if (!job) continue;

            await handleMenuSelection(conn, job, selectedId, m, pref);
            continue;
          }
        } catch (e) {
          console.error("[play] error menú:", e);
        }

        // 3) RESPUESTAS CITADAS (texto clásico)
        try {
          const context = m.message?.extendedTextMessage?.contextInfo;
          const citado = context?.stanzaId;
          const texto = String(m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim().toLowerCase();
          const job = pending[citado];
          const chatId = m.key.remoteJid;

          if (citado && job) {
            const qFromReply = extractQualityFromText(texto);

            if (["1", "audio", "4", "audiodoc"].includes(texto.split(/\s+/)[0])) {
              const docMode = texto.startsWith("4") || texto.includes("audiodoc");
              await conn.sendMessage(chatId, { react: { text: docMode ? "📄" : "🎵", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎶 Descargando audio (mp3)...` }, { quoted: m });
              await downloadAudio(conn, job, docMode, m);
            }
            else if (["2", "video", "3", "videodoc"].includes(texto.split(/\s+/)[0])) {
              const docMode = texto.startsWith("3") || texto.includes("videodoc");
              const useQuality = VALID_QUALITIES.has(qFromReply) ? qFromReply : (job.videoQuality || DEFAULT_VIDEO_QUALITY);

              await conn.sendMessage(chatId, { react: { text: docMode ? "📁" : "🎬", key: m.key } });
              await conn.sendMessage(chatId, { text: `🎥 Descargando video (${useQuality === "4k" ? "4K" : useQuality + "p"})...` }, { quoted: m });
              await downloadVideo(conn, { ...job, videoQuality: useQuality }, docMode, m);
            } else {
              await conn.sendMessage(chatId, { text: `⚠️ Opciones:\n1/audio → audio\n2/video → video\nEj: "video 720"` }, { quoted: m });
            }

            if (!job._timer) job._timer = setTimeout(() => delete pending[citado], 10 * 60 * 1000);
          }
        } catch (e) {}
      }
    });
  }

  // Marcar creación del job para que el menú encuentre el correcto
  pending[preview.key.id]._createdAt = Date.now();
};

// ====== Manejar selección del menú interactivo ======
async function handleMenuSelection(conn, job, selectedId, m, pref) {
  const chatId = m.key.remoteJid;
  const id = String(selectedId).trim();

  // Audio
  if (id === `${pref}play_audio` || id.endsWith("play_audio")) {
    await conn.sendMessage(chatId, { react: { text: "🎵", key: m.key } });
    await conn.sendMessage(chatId, { text: `🎶 Descargando audio (mp3)...` }, { quoted: m });
    return downloadAudio(conn, job, false, m);
  }

  if (id === `${pref}play_audiodoc` || id.endsWith("play_audiodoc")) {
    await conn.sendMessage(chatId, { react: { text: "📄", key: m.key } });
    await conn.sendMessage(chatId, { text: `🎶 Descargando audio como documento...` }, { quoted: m });
    return downloadAudio(conn, job, true, m);
  }

  // Video con calidad específica (formato: play_video_720)
  const videoMatch = id.match(/play_video_(\d+|4k)$/i);
  if (videoMatch) {
    const q = videoMatch[1].toLowerCase();
    if (VALID_QUALITIES.has(q)) {
      await conn.sendMessage(chatId, { react: { text: "🎬", key: m.key } });
      await conn.sendMessage(chatId, { text: `🎥 Descargando video (${q === "4k" ? "4K" : q + "p"})...` }, { quoted: m });
      return downloadVideo(conn, { ...job, videoQuality: q }, false, m);
    }
  }

  // Video (calidad por defecto del job)
  if (id === `${pref}play_video` || id.endsWith("play_video")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    await conn.sendMessage(chatId, { react: { text: "🎬", key: m.key } });
    await conn.sendMessage(chatId, { text: `🎥 Descargando video (${q === "4k" ? "4K" : q + "p"})...` }, { quoted: m });
    return downloadVideo(conn, job, false, m);
  }

  // Video documento
  if (id === `${pref}play_videodoc` || id.endsWith("play_videodoc")) {
    const q = job.videoQuality || DEFAULT_VIDEO_QUALITY;
    await conn.sendMessage(chatId, { react: { text: "📁", key: m.key } });
    await conn.sendMessage(chatId, { text: `🎥 Descargando video como documento (${q === "4k" ? "4K" : q + "p"})...` }, { quoted: m });
    return downloadVideo(conn, job, true, m);
  }
}

// ====== Manejar reacciones (igual que antes) ======
async function handleDownload(conn, job, choice, quoted) {
  const mapping = { "👍": "audio", "❤️": "video", "📄": "audioDoc", "📁": "videoDoc" };
  const key = mapping[choice];
  if (!key) return;

  const isDoc = key.endsWith("Doc");

  if (key.startsWith("audio")) {
    await conn.sendMessage(job.chatId, { text: `⏳ Descargando audio (mp3)...` }, { quoted: quoted || job.commandMsg });
    return downloadAudio(conn, job, isDoc, quoted || job.commandMsg);
  }

  const useQuality = job.videoQuality || DEFAULT_VIDEO_QUALITY;
  await conn.sendMessage(job.chatId, { text: `⏳ Descargando video (${useQuality === "4k" ? "4K" : useQuality + "p"})...` }, { quoted: quoted || job.commandMsg });
  return downloadVideo(conn, job, isDoc, quoted || job.commandMsg);
}

async function downloadAudio(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;

  let resolved;
  try {
    resolved = await callYoutubeResolve(videoUrl, { type: "audio", format: DEFAULT_AUDIO_FORMAT });
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error API (audio): ${e.message}` }, { quoted });
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;
  if (!mediaUrl) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo obtener audio." }, { quoted });
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const inFile = path.join(tmp, `${Date.now()}_in.bin`);
  await downloadToFile(mediaUrl, inFile);

  const outMp3 = path.join(tmp, `${Date.now()}_${base}.mp3`);
  let outFile = outMp3;

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inFile).audioCodec("libmp3lame").audioBitrate("128k").format("mp3").save(outMp3).on("end", resolve).on("error", reject);
    });
    try { fs.unlinkSync(inFile); } catch {}
  } catch {
    outFile = inFile;
    asDocument = true;
  }

  const sizeMB = fileSizeMB(outFile);
  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(outFile); } catch {}
    await conn.sendMessage(chatId, { text: `❌ Audio > ${MAX_MB}MB.` }, { quoted });
    return;
  }

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "audio"]: fs.readFileSync(outFile),
      mimetype: "audio/mpeg",
      fileName: `${base}.mp3`,
      caption: asDocument ? `🎵 ${title}\n\n🤖 La Suki Bot\n🔗 https://api-sky.ultraplus.click` : undefined,
    },
    { quoted }
  );

  try { fs.unlinkSync(outFile); } catch {}
}

async function downloadVideo(conn, job, asDocument, quoted) {
  const { chatId, videoUrl, title } = job;
  const q = VALID_QUALITIES.has(job.videoQuality) ? job.videoQuality : DEFAULT_VIDEO_QUALITY;

  let resolved;
  try {
    resolved = await callYoutubeResolve(videoUrl, { type: "video", quality: q });
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error API (video): ${e.message}` }, { quoted });
    return;
  }

  const mediaUrl = resolved.dl_download || resolved.direct;
  if (!mediaUrl) {
    await conn.sendMessage(chatId, { text: "❌ No se pudo obtener video." }, { quoted });
    return;
  }

  const tmp = ensureTmp();
  const base = safeName(title);
  const tag = q === "4k" ? "4k" : `${q}p`;
  const file = path.join(tmp, `${Date.now()}_${base}_${tag}.mp4`);

  await downloadToFile(mediaUrl, file);

  const sizeMB = fileSizeMB(file);
  if (sizeMB > MAX_MB) {
    try { fs.unlinkSync(file); } catch {}
    await conn.sendMessage(chatId, { text: `❌ Video > ${MAX_MB}MB.` }, { quoted });
    return;
  }

  const finalCaption =
`🎬 𝗩𝗶𝗱𝗲𝗼: ${title}
⚡ 𝗖𝗮𝗹𝗶𝗱𝗮𝗱: ${tag}

🤖 𝗕𝗼𝘁: La Suki Bot
🔗 𝗔𝗣𝗜 𝘂𝘀𝗮𝗱𝗮: https://api-sky.ultraplus.click`;

  await conn.sendMessage(
    chatId,
    {
      [asDocument ? "document" : "video"]: fs.readFileSync(file),
      mimetype: "video/mp4",
      fileName: `${base}_${tag}.mp4`,
      caption: finalCaption,
    },
    { quoted }
  );

  try { fs.unlinkSync(file); } catch {}
}

module.exports.command = ["play10"];
