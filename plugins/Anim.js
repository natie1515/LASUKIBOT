// plugins/anim.js
// Responde a un sticker .was (Lottie) con una palabra clave.
// El bot extrae la animación del sticker, le inyecta la imagen guardada con .guarsk
// y la reempaqueta como un nuevo sticker .was animado.
//
// Usa adm-zip (100% JavaScript, sin necesidad del binario zip/unzip).
//
// Incluye un menú de EFECTOS para aplicar a la imagen antes de inyectarla:
// Original, Flip H/V, Rotación, Zoom In/Out, B/N, Negativo, etc.
//
// Uso: .anim <palabra>  (respondiendo a un sticker .was)

"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const AdmZip = require("adm-zip");

const IMAGES_DIR = path.resolve("./sticker_base");
const DB_FILE = path.resolve("./sticker_base.json");
const ANIM_DIR = path.resolve("./sticker_anim");
const TMP_DIR = path.resolve("./tmp");
const ACTIVOSS_FILE = path.resolve("./activoss.json");

if (!fs.existsSync(ANIM_DIR)) fs.mkdirSync(ANIM_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const pendingAnim = Object.create(null);

// ====== HELPERS ======
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

function sanitizeKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); } catch { return {}; }
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

function randomName(ext) {
  return `${Crypto.randomBytes(6).toString("hex")}.${ext}`;
}

// ====== 🎨 CATÁLOGO DE EFECTOS ======
const EFECTOS = {
  original: {
    label: "🖼️ Original",
    desc: "Imagen tal cual sin efectos",
    filter: null,
  },
  flip_h: {
    label: "↔️ Flip Horizontal",
    desc: "Voltea la imagen horizontalmente",
    filter: "hflip",
  },
  flip_v: {
    label: "↕️ Flip Vertical",
    desc: "Voltea la imagen verticalmente",
    filter: "vflip",
  },
  rot90: {
    label: "🔄 Rotar 90°",
    desc: "Gira 90 grados",
    filter: "transpose=1",
  },
  rot180: {
    label: "🔃 Rotar 180°",
    desc: "De cabeza (180°)",
    filter: "transpose=2,transpose=2",
  },
  zoom_in: {
    label: "🔍 Zoom In",
    desc: "Acerca la imagen (crop central)",
    filter: "crop=iw/1.5:ih/1.5:(iw-iw/1.5)/2:(ih-ih/1.5)/2,scale=540:540",
  },
  zoom_out: {
    label: "🔭 Zoom Out",
    desc: "Aleja la imagen (con marco)",
    filter: "scale=400:400,pad=540:540:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
  },
  bn: {
    label: "⚫ Blanco y Negro",
    desc: "Convierte a escala de grises",
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
  hue_rojo: {
    label: "🔴 Tonalidad Rojo",
    desc: "Cambia tonalidad a rojo",
    filter: "hue=h=0:s=1.5",
  },
  hue_azul: {
    label: "🔵 Tonalidad Azul",
    desc: "Cambia tonalidad a azul",
    filter: "hue=h=210:s=1.5",
  },
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
};

// ====== APLICAR EFECTO A IMAGEN ======
async function applyEffect(inputPath, effectKey) {
  const efecto = EFECTOS[effectKey];
  if (!efecto) throw new Error(`Efecto desconocido: ${effectKey}`);

  const tmpOut = path.join(TMP_DIR, randomName("png"));

  return new Promise((resolve, reject) => {
    const filterChain = efecto.filter
      ? `${efecto.filter},scale=540:540:force_original_aspect_ratio=decrease,pad=540:540:(ow-iw)/2:(oh-ih)/2:color=0x00000000`
      : `scale=540:540:force_original_aspect_ratio=decrease,pad=540:540:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;

    ffmpeg(inputPath)
      .outputOptions([
        "-vf", filterChain,
        "-frames:v", "1",
      ])
      .on("error", reject)
      .on("end", () => resolve(tmpOut))
      .save(tmpOut);
  });
}

// ====== LÓGICA LOTTIE CON ADM-ZIP ======
function toDataUri(buffer, mime = "image/png") {
  if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("Buffer inválido.");
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

// Detectar si un buffer es un ZIP (.was es un ZIP)
function isZipBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  return buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
}

// 🔑 Núcleo: abre .was, reemplaza imagen base64 en todos los JSON, reempaqueta
function rebuildWasWithImage(wasBuffer, imageBuffer) {
  // 1) Abrir el .was como ZIP
  const zip = new AdmZip(wasBuffer);
  const entries = zip.getEntries();

  if (!entries || entries.length === 0) {
    throw new Error("El sticker .was está vacío o corrupto.");
  }

  // 2) Buscar todos los JSON y reemplazar imágenes base64 en ellos
  const dataUri = toDataUri(imageBuffer, "image/png");
  let replacedTotal = 0;
  let jsonEncontrados = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.toLowerCase().endsWith(".json")) continue;

    jsonEncontrados++;
    try {
      const rawContent = entry.getData().toString("utf8");
      const json = JSON.parse(rawContent);

      if (!Array.isArray(json.assets)) continue;

      let changedInThisJson = false;
      for (const asset of json.assets) {
        if (typeof asset?.p === "string" && asset.p.startsWith("data:image/")) {
          asset.p = dataUri;
          changedInThisJson = true;
          replacedTotal++;
        }
      }

      if (changedInThisJson) {
        zip.updateFile(entry.entryName, Buffer.from(JSON.stringify(json), "utf8"));
      }
    } catch (e) {
      // JSON inválido, lo saltamos
    }
  }

  if (jsonEncontrados === 0) {
    throw new Error("El sticker .was no contiene archivos JSON.");
  }

  if (replacedTotal === 0) {
    throw new Error("El sticker .was no tiene imagen base64 reemplazable.");
  }

  // 3) Devolver el buffer del .was actualizado
  return zip.toBuffer();
}

// ====== PROCESAR Y ENVIAR ======
async function procesarEfecto(conn, job, effectKey, triggerMsg) {
  const { chatId, keyword, safeKey, basePath, wasBuffer, quotedBase } = job;
  job.isBusy = true;

  let effectImage = null;

  try {
    const efecto = EFECTOS[effectKey];
    if (!efecto) throw new Error("Efecto no encontrado.");

    await conn.sendMessage(chatId, { react: { text: "⏳", key: triggerMsg.key } });
    await conn.sendMessage(chatId, {
      text: `🎨 Aplicando efecto *${efecto.label}* y ensamblando sticker...`
    }, { quoted: quotedBase });

    // 1) Aplicar efecto a la imagen base
    effectImage = await applyEffect(basePath, effectKey);
    const imgBuffer = fs.readFileSync(effectImage);

    // 2) Reconstruir el .was con la imagen nueva
    const newWasBuffer = rebuildWasWithImage(wasBuffer, imgBuffer);

    // 3) Guardar el resultado
    const outputPath = path.join(ANIM_DIR, `${safeKey}_${effectKey}.was`);
    fs.writeFileSync(outputPath, newWasBuffer);

    // 4) Enviar como sticker .was nativo
    await conn.sendMessage(chatId, {
      sticker: newWasBuffer,
      mimetype: "application/was",
    }, { quoted: quotedBase });

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });

  } catch (e) {
    console.error("[anim] error:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    await conn.sendMessage(chatId, {
      text: `❌ Error al aplicar efecto: \`${e.message}\``
    }, { quoted: quotedBase });
  } finally {
    try { if (effectImage) fs.unlinkSync(effectImage); } catch {}
    job.isBusy = false;
  }
}

// ====== HANDLER PRINCIPAL ======
const handler = async (msg, { conn, wa, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  const keyword = (args || []).join(" ").trim();
  if (!keyword) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Indica la palabra clave de la imagen.*

✳️ Uso:
*${pref}anim <palabra>* (respondiendo a un sticker .was)

Ejemplos:
• ${pref}anim hola
• ${pref}anim cara feliz

💡 Antes guarda la imagen con:
*${pref}guarsk <palabra>*`,
    }, { quoted: msg });
  }

  const safeKey = sanitizeKey(keyword);
  const db = loadDB();
  const entry = db[safeKey];

  if (!entry || !fs.existsSync(entry.path)) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *No hay imagen guardada con esa palabra clave.*

🗝️ Buscado: \`${keyword}\`

Guárdala primero con:
*${pref}guarsk ${keyword}* (respondiendo a una imagen)`,
    }, { quoted: msg });
  }

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.stickerMessage) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Debes responder a un sticker .was (animado Lottie).*

✳️ Uso:
*${pref}anim ${keyword}* (respondiendo al sticker .was)`,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "📥", key: msg.key } });

  let wasBuffer;
  try {
    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys.");

    const stream = await WA.downloadContentFromMessage(quoted.stickerMessage, "sticker");
    wasBuffer = Buffer.alloc(0);
    for await (const chunk of stream) wasBuffer = Buffer.concat([wasBuffer, chunk]);

    if (!wasBuffer.length) throw new Error("El sticker está vacío.");

    if (!isZipBuffer(wasBuffer)) {
      await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
      return conn.sendMessage(chatId, {
        text:
`❌ *Ese no es un sticker animado .was*

Solo sirve con stickers animados tipo Lottie (los que WhatsApp marca como "beta/animados").

Los stickers normales WebP no tienen animación Lottie reemplazable.`,
      }, { quoted: msg });
    }
  } catch (e) {
    console.error("[anim] error descargando:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: `❌ Error al descargar el sticker: \`${e.message}\``,
    }, { quoted: msg });
  }

  const usarBotones = botonesActivos();

  const efectosEntries = Object.entries(EFECTOS);
  const listaNumerada = efectosEntries
    .map(([k, v], i) => `   *${i + 1}* →  ${v.label}`)
    .join("\n");

  const caption = usarBotones
    ? `
╭━━━━━━━━━━━━━━━━━━━━╮
   🎬 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗟𝗢𝗧𝗧𝗜𝗘
╰━━━━━━━━━━━━━━━━━━━━╯

🗝️ *Imagen:* ${keyword}
✅ *Sticker .was detectado*

━━━━━━━━━━━━━━━━━━━━
 *🎨 ELIGE UN EFECTO*
━━━━━━━━━━━━━━━━━━━━

El efecto se aplica a tu imagen *antes* de meterla en la animación.

🟢 *OPCIÓN 1 — Botones*
Toca *🎨 Menú de efectos* abajo.

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe el número:
${listaNumerada}

━━━━━━━━━━━━━━━━━━━━
🤖 *La Suki Bot*
━━━━━━━━━━━━━━━━━━━━`.trim()
    : `
╭━━━━━━━━━━━━━━━━━━━━╮
   🎬 𝗦𝗧𝗜𝗖𝗞𝗘𝗥 𝗟𝗢𝗧𝗧𝗜𝗘
╰━━━━━━━━━━━━━━━━━━━━╯

🗝️ *Imagen:* ${keyword}
✅ *Sticker .was detectado*

━━━━━━━━━━━━━━━━━━━━
 *🎨 ELIGE UN EFECTO*
━━━━━━━━━━━━━━━━━━━━

Cita este mensaje y escribe el número:
${listaNumerada}

━━━━━━━━━━━━━━━━━━━━
🤖 *La Suki Bot*
━━━━━━━━━━━━━━━━━━━━`.trim();

  const NUMERO_EFECTO = {};
  efectosEntries.forEach(([k], i) => { NUMERO_EFECTO[String(i + 1)] = k; });

  const nativeFlowButtons = [
    {
      text: "🎨 Menú de efectos",
      sections: [
        {
          title: "🎨 EFECTOS DE IMAGEN",
          highlight_label: ".was",
          rows: efectosEntries.map(([k, v]) => ({
            header: "",
            title: v.label,
            description: v.desc,
            id: `${pref}efec_${k}`,
          })),
        },
      ],
    },
  ];

  let preview;
  if (usarBotones) {
    try {
      preview = await conn.sendMessage(chatId, {
        image: { url: entry.path },
        caption,
        footer: "❦ La Suki Bot — Elige un efecto ❦",
        buttons: nativeFlowButtons,
        headerType: 4,
      }, { quoted: msg });
    } catch (e) {
      console.log("[anim] botones fallaron, fallback:", e.message);
      preview = await conn.sendMessage(chatId, {
        image: { url: entry.path },
        caption,
      }, { quoted: msg });
    }
  } else {
    preview = await conn.sendMessage(chatId, {
      image: { url: entry.path },
      caption,
    }, { quoted: msg });
  }

  pendingAnim[preview.key.id] = {
    chatId,
    keyword,
    safeKey,
    basePath: entry.path,
    wasBuffer,
    quotedBase: msg,
    isBusy: false,
    _createdAt: Date.now(),
    numeroMap: NUMERO_EFECTO,
  };

  setTimeout(() => {
    delete pendingAnim[preview.key.id];
  }, 10 * 60 * 1000);

  if (!conn._animLottieListener) {
    conn._animLottieListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          // A) BOTONES / MENÚ
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
            if (!selectedId.includes("efec_")) continue;

            const match = selectedId.match(/efec_([a-z0-9_]+)/i);
            if (!match) continue;
            const effectKey = match[1].toLowerCase();
            if (!EFECTOS[effectKey]) continue;

            const ctxQuoted = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
            let job = null;
            if (ctxQuoted && pendingAnim[ctxQuoted]) {
              job = pendingAnim[ctxQuoted];
            } else {
              const jobs = Object.values(pendingAnim)
                .filter(j => j.chatId === m.key.remoteJid)
                .sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));
              if (jobs.length > 0) job = jobs[0];
            }
            if (!job || job.isBusy) continue;

            await procesarEfecto(conn, job, effectKey, m);
            continue;
          }

          // B) RESPUESTAS CITADAS (número)
          const ctx = m.message?.extendedTextMessage?.contextInfo;
          const citado = ctx?.stanzaId;
          const job = pendingAnim[citado];

          if (citado && job) {
            const texto = String(
              m.message?.conversation ||
              m.message?.extendedTextMessage?.text ||
              ""
            ).trim().toLowerCase();

            const firstWord = texto.split(/\s+/)[0];
            const effectKey = job.numeroMap[firstWord];

            if (effectKey && EFECTOS[effectKey]) {
              if (job.isBusy) continue;
              await procesarEfecto(conn, job, effectKey, m);
            }
          }
        } catch (e) {
          console.error("[anim] listener error:", e);
        }
      }
    });
  }
};

handler.command = ["anim"];
handler.help = ["anim <palabra>"];
handler.tags = ["stickers"];
module.exports = handler;
