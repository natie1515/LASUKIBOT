// plugins/sks.js — Creador de Stickers con Efectos
// Responde a una IMAGEN o VIDEO, muestra un menú con 20 efectos,
// y crea un sticker WebP (animado si es video) con el efecto aplicado.
//
// ✅ Usa la misma lógica de s.js (imageToWebp / videoToWebp + addExif)
// ✅ Menú de botones igual que play.js (nativeFlow con sections/rows)
// ✅ Respeta activoss.json (botones on/off)
// ✅ Menú activo 10 minutos — puedes probar varios efectos con la misma imagen
//
// Uso: .sks  (respondiendo a una imagen o video)

"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const webp = require("node-webpmux");

const TMP_DIR = path.resolve("./tmp");
const ACTIVOSS_FILE = path.resolve("./activoss.json");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ====== JOBS PENDIENTES (10 min) ======
const pendingSks = Object.create(null);

// ====== HELPERS ======
function unwrapMessage(m) {
  let n = m;
  let depth = 0;
  while (n && depth < 10) {
    const next =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message ||
      n.documentWithCaptionMessage?.message ||
      null;
    if (!next) break;
    n = next;
    depth++;
  }
  return n;
}

function ensureWA(wa, conn) {
  if (wa && wa.downloadContentFromMessage) return wa;
  if (conn && conn.wa && conn.wa.downloadContentFromMessage) return conn.wa;
  if (global.wa && global.wa.downloadContentFromMessage) return global.wa;
  return null;
}

function randomFileName(ext) {
  return `${Crypto.randomBytes(6).toString("hex")}.${ext}`;
}

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

// ====== 🎨 CATÁLOGO DE 20 EFECTOS ======
// Cada efecto tiene: label visible, desc, y filter FFmpeg (null = sin efecto)
const EFECTOS = {
  // === SIN EFECTO VISUAL / TRANSFORMACIONES BÁSICAS ===
  normal: {
    label: "🖼️ Normal",
    desc: "Sin efecto, sticker normal",
    filter: null,
  },
  flip_h: {
    label: "↔️ Voltear Derecha",
    desc: "Voltea horizontal (espejo)",
    filter: "hflip",
  },
  flip_v: {
    label: "↕️ Voltear Izquierda",
    desc: "Voltea vertical",
    filter: "vflip",
  },
  rot90: {
    label: "🔄 Voltear Redondo 90°",
    desc: "Gira 90 grados",
    filter: "transpose=1",
  },
  rot180: {
    label: "🔃 De Cabeza 180°",
    desc: "Pone de cabeza",
    filter: "transpose=2,transpose=2",
  },
  rot270: {
    label: "🔁 Voltear Redondo 270°",
    desc: "Gira 270 grados",
    filter: "transpose=2",
  },
  // === ZOOM ===
  zoom_in: {
    label: "🔍 Zoom In",
    desc: "Acerca la imagen",
    filter: "crop=iw/1.5:ih/1.5:(iw-iw/1.5)/2:(ih-ih/1.5)/2",
  },
  zoom_out: {
    label: "🔭 Zoom Out",
    desc: "Aleja la imagen con marco",
    filter: "scale=iw*0.7:ih*0.7,pad=iw/0.7:ih/0.7:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
  },
  // === COLORES ===
  bn: {
    label: "⚫ Blanco y Negro",
    desc: "Escala de grises",
    filter: "hue=s=0",
  },
  negativo: {
    label: "🌓 Negativo",
    desc: "Invierte los colores",
    filter: "negate",
  },
  sepia: {
    label: "🟤 Sepia",
    desc: "Efecto foto antigua",
    filter: "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
  },
  rojo: {
    label: "🔴 Tono Rojo",
    desc: "Tonalidad rojiza",
    filter: "hue=h=0:s=1.5",
  },
  azul: {
    label: "🔵 Tono Azul",
    desc: "Tonalidad azul",
    filter: "hue=h=210:s=1.5",
  },
  verde: {
    label: "🟢 Tono Verde",
    desc: "Tonalidad verde",
    filter: "hue=h=120:s=1.5",
  },
  amarillo: {
    label: "🟡 Tono Amarillo",
    desc: "Tonalidad amarilla",
    filter: "hue=h=60:s=1.5",
  },
  // === BRILLO / CONTRASTE ===
  brillo: {
    label: "☀️ Más Brillo",
    desc: "Aumenta el brillo",
    filter: "eq=brightness=0.15:saturation=1.3",
  },
  contraste: {
    label: "🎯 Más Contraste",
    desc: "Aumenta el contraste",
    filter: "eq=contrast=1.5:saturation=1.2",
  },
  saturado: {
    label: "🌈 Súper Saturado",
    desc: "Colores intensos",
    filter: "eq=saturation=2.5",
  },
  // === EFECTOS ARTÍSTICOS ===
  oscuro: {
    label: "🌑 Oscuro",
    desc: "Más oscuro / nocturno",
    filter: "eq=brightness=-0.15:contrast=1.3",
  },
  vintage: {
    label: "📷 Vintage",
    desc: "Look retro vintage",
    filter: "curves=vintage,vignette",
  },
};

// ====== FFMPEG: imagen → webp con efecto ======
async function imageToWebp(media, effectFilter) {
  const tmpIn = path.join(TMP_DIR, randomFileName("jpg"));
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  fs.writeFileSync(tmpIn, media);

  // Filtro base (escala y padding como en s.js) + efecto opcional al inicio
  const baseFilter = "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse";
  const fullFilter = effectFilter ? `${effectFilter},${baseFilter}` : baseFilter;

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .on("error", reject)
      .on("end", resolve)
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf", fullFilter,
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch {}
  try { fs.unlinkSync(tmpOut); } catch {}
  return buff;
}

// ====== FFMPEG: video → webp animado con efecto ======
async function videoToWebp(media, effectFilter) {
  const tmpIn = path.join(TMP_DIR, randomFileName("mp4"));
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  fs.writeFileSync(tmpIn, media);

  const baseFilter = "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse";
  const fullFilter = effectFilter ? `${effectFilter},${baseFilter}` : baseFilter;

  await new Promise((resolve, reject) => {
    ffmpeg(tmpIn)
      .on("error", reject)
      .on("end", resolve)
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf", fullFilter,
        "-loop", "0",
        "-ss", "00:00:00",
        "-t", "00:00:05",
        "-preset", "default",
        "-an",
        "-vsync", "0",
      ])
      .toFormat("webp")
      .save(tmpOut);
  });

  const buff = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch {}
  try { fs.unlinkSync(tmpOut); } catch {}
  return buff;
}

// ====== Agregar EXIF (metadata) ======
async function addExif(webpBuffer, metadata) {
  const tmpIn = path.join(TMP_DIR, randomFileName("webp"));
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  fs.writeFileSync(tmpIn, webpBuffer);

  const json = {
    "sticker-pack-id": "suki-sks",
    "sticker-pack-name": metadata.packname,
    "sticker-pack-publisher": metadata.author,
    emojis: metadata.categories || [""],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00,
    0x00, 0x00,
  ]);

  const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);

  const img = new webp.Image();
  await img.load(tmpIn);
  img.exif = exif;
  await img.save(tmpOut);
  try { fs.unlinkSync(tmpIn); } catch {}
  return tmpOut;
}

async function writeExifImg(media, metadata, effectFilter) {
  const wMedia = await imageToWebp(media, effectFilter);
  return await addExif(wMedia, metadata);
}

async function writeExifVid(media, metadata, effectFilter) {
  const wMedia = await videoToWebp(media, effectFilter);
  return await addExif(wMedia, metadata);
}

// ====== PROCESAR Y ENVIAR STICKER ======
async function procesarEfecto(conn, job, effectKey, triggerMsg) {
  const { chatId, mediaType, mediaBuffer, senderName, quotedBase } = job;
  if (job.isBusy) return;
  job.isBusy = true;

  try {
    const efecto = EFECTOS[effectKey];
    if (!efecto) throw new Error("Efecto no encontrado.");

    await conn.sendMessage(chatId, { react: { text: "🛠️", key: triggerMsg.key } });

    const fecha = new Date();
    const fechaStr = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()} ${fecha.getHours()}:${fecha.getMinutes()}`;

    const metadata = {
      packname: `✨ ${efecto.label} — ${senderName}`,
      author: `🦋 Bot Creador: ❦La Suki Bot❦\n🎨 Efecto: ${efecto.label}\n🛠️ Desarrollado por: Russell XZ 💻\n📅 ${fechaStr}`,
    };

    const outSticker =
      mediaType === "image"
        ? await writeExifImg(mediaBuffer, metadata, efecto.filter)
        : await writeExifVid(mediaBuffer, metadata, efecto.filter);

    await conn.sendMessage(
      chatId,
      { sticker: { url: outSticker } },
      { quoted: quotedBase }
    );

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });

    try { fs.unlinkSync(outSticker); } catch {}
  } catch (err) {
    console.error("[sks] Error:", err);
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    await conn.sendMessage(chatId, {
      text: `❌ Error al aplicar efecto: \`${err.message}\``,
    }, { quoted: quotedBase });
  } finally {
    job.isBusy = false;
  }
}

// ====== HANDLER PRINCIPAL ======
const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  // 🎯 Buscar media citada
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.imageMessage && !quoted?.videoMessage) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Responde a una imagen o video para crear un sticker.*

✳️ Ejemplo:
*${pref}sks* (respondiendo a una imagen o video)

💡 Los videos se convierten en stickers *animados*.`,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  // Descargar media
  let mediaBuffer, mediaType;
  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys.");

    mediaType = quoted.imageMessage ? "image" : "video";
    const mediaNode = quoted[`${mediaType}Message`];

    const stream = await WA.downloadContentFromMessage(mediaNode, mediaType);
    mediaBuffer = Buffer.alloc(0);
    for await (const chunk of stream) mediaBuffer = Buffer.concat([mediaBuffer, chunk]);

    if (!mediaBuffer.length) throw new Error("Media vacía.");
  } catch (e) {
    console.error("[sks] error descargando:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al descargar el media: \`${e.message}\``,
    }, { quoted: msg });
  }

  const senderName = msg.pushName || "Usuario";
  const usarBotones = botonesActivos();

  // Lista numerada de efectos (para botones OFF)
  const efectosEntries = Object.entries(EFECTOS);
  const listaNumerada = efectosEntries
    .map(([k, v], i) => `   *${i + 1}* →  ${v.label}`)
    .join("\n");

  // Mapa número → key de efecto (para respuestas citadas)
  const NUMERO_EFECTO = {};
  efectosEntries.forEach(([k], i) => { NUMERO_EFECTO[String(i + 1)] = k; });

  // 🎨 Caption (ON = corto, OFF = lista completa)
  const caption = usarBotones
    ? `
╭━━━━━━━━━━━━━━━━╮
🎨 *CREADOR SKS PRO* 🎨
╰━━━━━━━━━━━━━━━━╯

Toca el botón abajo para elegir el efecto que deseas aplicarle a tu sticker.

❦ La Suki Bot ❦
`.trim()
    : `
╭━━━━━━━━━━━━━━━━━━━━╮
🎨 *CREADOR SKS PRO* 🎨
╰━━━━━━━━━━━━━━━━━━━━╯

📎 *Media:* ${mediaType === "video" ? "🎬 Video (sticker animado)" : "🖼️ Imagen"}

━━━━━━━━━━━━━━━━━━━━
 *🎨 ELIGE UN EFECTO*
━━━━━━━━━━━━━━━━━━━━

Cita este mensaje y escribe el número:
${listaNumerada}

💡 El menú queda activo *10 minutos*. Puedes probar varios efectos con la misma imagen.

━━━━━━━━━━━━━━━━━━━━
❦ La Suki Bot ❦
━━━━━━━━━━━━━━━━━━━━`.trim();

  // ====== MENÚ INTERACTIVO (estilo play.js) ======
  const nativeFlowButtons = [
    {
      text: "🎨 Menú de efectos",
      sections: [
        {
          title: "🎨 EFECTOS BÁSICOS",
          highlight_label: "SKS",
          rows: [
            { header: "", title: EFECTOS.normal.label,   description: EFECTOS.normal.desc,   id: `${pref}sks_normal`   },
            { header: "", title: EFECTOS.flip_h.label,   description: EFECTOS.flip_h.desc,   id: `${pref}sks_flip_h`   },
            { header: "", title: EFECTOS.flip_v.label,   description: EFECTOS.flip_v.desc,   id: `${pref}sks_flip_v`   },
            { header: "", title: EFECTOS.rot90.label,    description: EFECTOS.rot90.desc,    id: `${pref}sks_rot90`    },
            { header: "", title: EFECTOS.rot180.label,   description: EFECTOS.rot180.desc,   id: `${pref}sks_rot180`   },
            { header: "", title: EFECTOS.rot270.label,   description: EFECTOS.rot270.desc,   id: `${pref}sks_rot270`   },
            { header: "", title: EFECTOS.zoom_in.label,  description: EFECTOS.zoom_in.desc,  id: `${pref}sks_zoom_in`  },
            { header: "", title: EFECTOS.zoom_out.label, description: EFECTOS.zoom_out.desc, id: `${pref}sks_zoom_out` },
          ],
        },
        {
          title: "🎨 COLORES",
          highlight_label: "FX",
          rows: [
            { header: "", title: EFECTOS.bn.label,        description: EFECTOS.bn.desc,        id: `${pref}sks_bn`        },
            { header: "", title: EFECTOS.negativo.label,  description: EFECTOS.negativo.desc,  id: `${pref}sks_negativo`  },
            { header: "", title: EFECTOS.sepia.label,     description: EFECTOS.sepia.desc,     id: `${pref}sks_sepia`     },
            { header: "", title: EFECTOS.rojo.label,      description: EFECTOS.rojo.desc,      id: `${pref}sks_rojo`      },
            { header: "", title: EFECTOS.azul.label,      description: EFECTOS.azul.desc,      id: `${pref}sks_azul`      },
            { header: "", title: EFECTOS.verde.label,     description: EFECTOS.verde.desc,     id: `${pref}sks_verde`     },
            { header: "", title: EFECTOS.amarillo.label,  description: EFECTOS.amarillo.desc,  id: `${pref}sks_amarillo`  },
          ],
        },
        {
          title: "🎨 ARTÍSTICOS",
          highlight_label: "PRO",
          rows: [
            { header: "", title: EFECTOS.brillo.label,    description: EFECTOS.brillo.desc,    id: `${pref}sks_brillo`    },
            { header: "", title: EFECTOS.contraste.label, description: EFECTOS.contraste.desc, id: `${pref}sks_contraste` },
            { header: "", title: EFECTOS.saturado.label,  description: EFECTOS.saturado.desc,  id: `${pref}sks_saturado`  },
            { header: "", title: EFECTOS.oscuro.label,    description: EFECTOS.oscuro.desc,    id: `${pref}sks_oscuro`    },
            { header: "", title: EFECTOS.vintage.label,   description: EFECTOS.vintage.desc,   id: `${pref}sks_vintage`   },
          ],
        },
      ],
    },
  ];

  // ====== ENVIAR MENSAJE ======
  let preview;
  if (usarBotones) {
    try {
      preview = await conn.sendMessage(chatId, {
        text: caption,
        footer: "❦ Selecciona un efecto del menú ❦",
        buttons: nativeFlowButtons,
        headerType: 1,
      }, { quoted: msg });
    } catch (e) {
      console.log("[sks] menú nativo falló, fallback:", e.message);
      preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
    }
  } else {
    preview = await conn.sendMessage(chatId, { text: caption }, { quoted: msg });
  }

  // ====== GUARDAR JOB (10 minutos) ======
  pendingSks[preview.key.id] = {
    chatId,
    mediaType,
    mediaBuffer,
    senderName,
    quotedBase: msg,
    isBusy: false,
    _createdAt: Date.now(),
    numeroMap: NUMERO_EFECTO,
  };

  setTimeout(() => {
    delete pendingSks[preview.key.id];
  }, 10 * 60 * 1000); // 10 minutos

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  // ====== LISTENER ÚNICO ======
  if (!conn._sksListener) {
    conn._sksListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          // 1) BOTONES / MENÚ INTERACTIVO
          const interactiveReply =
            m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
            m.message?.listResponseMessage ||
            m.message?.buttonsResponseMessage ||
            m.message?.templateButtonReplyMessage ||
            null;

          if (interactiveReply) {
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
            // Solo IDs propios de sks (evita conflictos con play/ytmp3/etc)
            if (!selectedId.includes("sks_")) continue;

            const match = selectedId.match(/sks_([a-z0-9_]+)/i);
            if (!match) continue;
            const effectKey = match[1].toLowerCase();
            if (!EFECTOS[effectKey]) continue;

            // Buscar job (prioridad: mensaje citado, luego el más reciente del chat)
            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;

            if (ctxQuoted && pendingSks[ctxQuoted]) {
              job = pendingSks[ctxQuoted];
            } else {
              const jobsInChat = Object.values(pendingSks)
                .filter(j => j.chatId === m.key.remoteJid)
                .sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
              if (jobsInChat.length > 0) job = jobsInChat[0];
            }

            if (!job) continue;

            await procesarEfecto(conn, job, effectKey, m);
            continue;
          }

          // 2) RESPUESTAS CITADAS (número)
          const ctxReply = m.message?.extendedTextMessage?.contextInfo;
          const citado = ctxReply?.stanzaId;
          const job = pendingSks[citado];

          if (citado && job) {
            const texto = String(
              m.message?.conversation ||
              m.message?.extendedTextMessage?.text ||
              ""
            ).trim().toLowerCase();

            const firstWord = texto.split(/\s+/)[0];
            const effectKey = job.numeroMap[firstWord];

            if (effectKey && EFECTOS[effectKey]) {
              await procesarEfecto(conn, job, effectKey, m);
            }
          }
        } catch (e) {
          console.error("[sks] listener error:", e);
        }
      }
    });
  }
};

handler.command = ["sks"];
handler.help = ["sks"];
handler.tags = ["stickers"];
module.exports = handler;
