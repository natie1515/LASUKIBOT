// plugins/sks.js
// Creador de Stickers con Efectos Visuales y Animaciones
// Usa activoss.json para mostrar botones o menú de texto.

"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const webp = require("node-webpmux");

const ACTIVOSS_FILE = path.resolve("./activoss.json");
const tempFolder = path.join(__dirname, "../tmp/");
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

// === Memoria Temporal ===
const pendingSks = {};

// === Helpers Básicos ===
function safeName(ext) {
  return `${Crypto.randomBytes(6).readUIntLE(0, 6).toString(36)}.${ext}`;
}

function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}

function ensureWA(wa, conn) {
  if (wa && wa.downloadContentFromMessage) return wa;
  if (conn && conn.wa && conn.wa.downloadContentFromMessage) return conn.wa;
  if (global.wa && global.wa.downloadContentFromMessage) return global.wa;
  return null;
}

function botonesActivos() {
  if (!fs.existsSync(ACTIVOSS_FILE)) return true;
  try {
    const cfg = JSON.parse(fs.readFileSync(ACTIVOSS_FILE, "utf-8"));
    return cfg.botones !== false;
  } catch {
    return true;
  }
}

// === Comando Principal ===
const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.imageMessage && !quoted?.videoMessage) {
    return conn.sendMessage(
      chatId,
      { text: `⚠️ *Responde a una IMAGEN o VIDEO para crear un sticker con efectos.*\n\n✳️ Ejemplo:\n*${pref}sks* (respondiendo a una foto)` },
      { quoted: msg }
    );
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

    // Descargar el archivo multimedia a memoria (Buffer)
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys.");
    const mediaType = quoted.imageMessage ? "image" : "video";
    const mediaNode = quoted[`${mediaType}Message`];
    const stream = await WA.downloadContentFromMessage(mediaNode, mediaType);
    
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

    const senderName = msg.pushName || "Usuario";
    const usarBotones = botonesActivos();

    // 🎨 Textos del Menú
    const captionTexto = usarBotones
      ? `╭━━━━━━━━━━━━━━━━╮\n🎨 *CREADOR SKS PRO* 🎨\n╰━━━━━━━━━━━━━━━━╯\n\nToca el botón abajo para elegir el efecto que deseas aplicarle a tu sticker.`
      : `╭━━━━━━━━━━━━━━━━╮\n🎨 *CREADOR SKS PRO* 🎨\n╰━━━━━━━━━━━━━━━━╯\n\nResponde a este mensaje con el *NÚMERO* del efecto:\n\n*ESTÁTICOS:*\n1️⃣ Normal\n2️⃣ Volteado (Espejo)\n3️⃣ Al revés (Boca abajo)\n4️⃣ Redondo (Círculo)\n\n*ANIMADOS:*\n5️⃣ Zoom In\n6️⃣ Arcoíris (Colores psicodélicos)\n\n💡 _Ejemplo: Responde "4" para redondo._`;

    const nativeFlowButtons = [
      {
        name: "single_select",
        buttonParamsJson: JSON.stringify({
          title: "🪄 Elegir Efecto",
          sections: [
            {
              title: "Estáticos",
              rows: [
                { id: "efecto_1", title: "1️⃣ Normal", description: "Sticker estándar" },
                { id: "efecto_2", title: "2️⃣ Espejo", description: "Volteado horizontalmente" },
                { id: "efecto_3", title: "3️⃣ Al revés", description: "Volteado verticalmente" },
                { id: "efecto_4", title: "4️⃣ Redondo", description: "Recortado en círculo" },
              ],
            },
            {
              title: "Animados (Requiere procesar)",
              rows: [
                { id: "efecto_5", title: "5️⃣ Zoom In", description: "Acercamiento animado" },
                { id: "efecto_6", title: "6️⃣ Arcoíris", description: "Cambio de colores constante" },
              ],
            },
          ],
        }),
      },
    ];

    let preview;
    if (usarBotones) {
      try {
        preview = await conn.sendMessage(chatId, {
          text: captionTexto,
          buttons: nativeFlowButtons,
          headerType: 4,
          footer: "❦ La Suki Bot ❦"
        }, { quoted: msg });
      } catch (e) {
        preview = await conn.sendMessage(chatId, { text: captionTexto }, { quoted: msg });
      }
    } else {
      preview = await conn.sendMessage(chatId, { text: captionTexto }, { quoted: msg });
    }

    // 💾 Guardar en Memoria Temporal
    const jobId = preview.key.id;
    pendingSks[jobId] = {
      chatId,
      buffer,
      mediaType,
      senderName,
      commandMsg: msg,
      _timer: setTimeout(() => delete pendingSks[jobId], 5 * 60 * 1000) // Se borra a los 5 mins
    };

    // ====== LISTENER DE RESPUESTAS (UNA SOLA VEZ) ======
    if (!conn._sksListener) {
      conn._sksListener = true;
      conn.ev.on("messages.upsert", async (ev) => {
        for (const m of ev.messages) {
          
          let selectedId = null;
          let ctxQuoted = null;

          // Detectar Respuesta de Botón
          const interactiveReply = m.message?.interactiveResponseMessage?.nativeFlowResponseMessage;
          if (interactiveReply?.paramsJson) {
            try {
              const params = JSON.parse(interactiveReply.paramsJson);
              selectedId = params.id;
              ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId || Object.keys(pendingSks).find(k => pendingSks[k].chatId === m.key.remoteJid);
            } catch {}
          }

          // Detectar Respuesta de Texto (Citado)
          if (!selectedId && m.message?.extendedTextMessage) {
            ctxQuoted = m.message.extendedTextMessage.contextInfo?.stanzaId;
            const textRaw = m.message.extendedTextMessage.text?.trim();
            if (ctxQuoted && pendingSks[ctxQuoted] && /^[1-6]$/.test(textRaw)) {
              selectedId = `efecto_${textRaw}`;
            }
          }

          // Procesar si hay un trabajo pendiente y se eligió opción
          if (selectedId && ctxQuoted && pendingSks[ctxQuoted]) {
            const job = pendingSks[ctxQuoted];
            clearTimeout(job._timer); // Evitar que se borre mientras procesa
            delete pendingSks[ctxQuoted]; // Sacarlo de la cola

            await processStickerJob(conn, m, job, selectedId);
          }
        }
      });
    }

  } catch (err) {
    console.error("[sks] Error:", err);
    await conn.sendMessage(chatId, { text: "❌ Hubo un error al preparar la imagen." }, { quoted: msg });
  }
};

handler.command = ["sks"];
module.exports = handler;

// ==========================================
// ====== MOTOR DE PROCESAMIENTO FFmpeg =====
// ==========================================

async function processStickerJob(conn, m, job, effectId) {
  const { chatId, buffer, mediaType, senderName, commandMsg } = job;
  
  await conn.sendMessage(chatId, { react: { text: "🛠️", key: m.key } });
  
  const isVideo = mediaType === "video";
  const fechaStr = new Date().toLocaleString();
  const metadata = {
    packname: `✨ Efecto: ${effectId.replace("efecto_", "")}`,
    author: `🦋 Creador: La Suki Bot\n👤 Por: ${senderName}\n📅 ${fechaStr}`
  };

  try {
    const finalBuffer = await applyEffectToWebp(buffer, effectId, isVideo);
    const finalSticker = await addExif(finalBuffer, metadata);

    await conn.sendMessage(chatId, { sticker: { url: finalSticker } }, { quoted: commandMsg });
    await conn.sendMessage(chatId, { react: { text: "✅", key: m.key } });
    try { fs.unlinkSync(finalSticker); } catch {}
  } catch (e) {
    console.error("[sks proc] Error:", e);
    await conn.sendMessage(chatId, { text: "❌ Falla al renderizar el efecto. Intenta con un archivo más ligero." }, { quoted: m });
  }
}

async function applyEffectToWebp(buffer, effectId, isVideo) {
  const ext = isVideo ? "mp4" : "jpg";
  const tmpIn = path.join(tempFolder, safeName(ext));
  const tmpOut = path.join(tempFolder, safeName("webp"));
  fs.writeFileSync(tmpIn, buffer);

  // Filtro base para mantener transparencia y tamaño
  let vfFilter = "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0";
  let outputOptions = ["-vcodec", "libwebp"];
  let inputOptions = [];

  // Agregar lógica condicional según el efecto
  switch (effectId) {
    case "efecto_2": // Espejo (H-Flip)
      vfFilter += ",hflip";
      break;
    case "efecto_3": // Al revés (V-Flip)
      vfFilter += ",vflip";
      break;
    case "efecto_4": // Redondo
      // Crea una máscara circular matemática usando geq
      vfFilter += ",format=rgba,geq=lum='p(X,Y)':a='if(gt(hypot(X-W/2,Y-H/2),min(W,H)/2),0,255)'";
      break;
    case "efecto_5": // Zoom In animado
      if (!isVideo) inputOptions.push("-loop", "1"); // Forzar repetición en fotos
      vfFilter = "zoompan=z='min(zoom+0.03,1.5)':d=45:s=320x320"; // Zoom gradual de 45 frames
      outputOptions.push("-t", "3"); // 3 segundos máximo
      break;
    case "efecto_6": // Arcoíris animado
      if (!isVideo) inputOptions.push("-loop", "1");
      // Mueve el tono (hue) multiplicando por el tiempo
      vfFilter += ",hue=h='t*90':s=2"; 
      outputOptions.push("-t", "3");
      break;
  }

  // Si no es un efecto animado forzado, aplicamos la paleta para que pese poco
  if (effectId !== "efecto_5" && effectId !== "efecto_6") {
    vfFilter += ",split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse";
    if (isVideo) outputOptions.push("-loop", "0", "-t", "00:00:05", "-preset", "default");
  } else {
    outputOptions.push("-loop", "0"); // Para que la animación se repita infinito
  }

  outputOptions.push("-an", "-vsync", "0"); // Quitar audio y sincronizar frames

  await new Promise((resolve, reject) => {
    let cmd = ffmpeg(tmpIn).on("error", reject).on("end", resolve);
    if (inputOptions.length > 0) cmd = cmd.inputOptions(inputOptions);
    cmd.outputOptions(["-vf", vfFilter, ...outputOptions]).toFormat("webp").save(tmpOut);
  });

  const outBuff = fs.readFileSync(tmpOut);
  try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch {}
  return outBuff;
}

// ====== Función de Metadatos ======
async function addExif(webpBuffer, metadata) {
  const tmpIn = path.join(tempFolder, safeName("webp"));
  const tmpOut = path.join(tempFolder, safeName("webp"));
  fs.writeFileSync(tmpIn, webpBuffer);

  const json = {
    "sticker-pack-id": "suki-pro",
    "sticker-pack-name": metadata.packname,
    "sticker-pack-publisher": metadata.author,
    emojis: [""],
  };

  const exifAttr = Buffer.from([ 0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00 ]);
  const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);

  const img = new webp.Image();
  await img.load(tmpIn);
  img.exif = exif;
  await img.save(tmpOut);
  fs.unlinkSync(tmpIn);
  return tmpOut;
}
