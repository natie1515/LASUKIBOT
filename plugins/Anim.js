// plugins/anim.js
// Aplica una animación a un sticker guardado con .guarsk
// Uso: .anim <palabra clave>
// Se abre un menú de botones para elegir la animación.

"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const webp = require("node-webpmux");

const STICKERS_DIR = path.resolve("./sticker_base");
const DB_FILE = path.resolve("./sticker_base.json");
const ANIM_DIR = path.resolve("./sticker_anim");
const TMP_DIR = path.resolve("./tmp");
const ACTIVOSS_FILE = path.resolve("./activoss.json");

if (!fs.existsSync(ANIM_DIR)) fs.mkdirSync(ANIM_DIR, { recursive: true });
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const pendingAnim = Object.create(null);

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

// 🎬 ===== CATÁLOGO DE ANIMACIONES =====
// Cada animación tiene un id corto, su label visible y un filtro FFmpeg.
// FPS = 12, duración = 2.5s (aprox 30 frames), tamaño 320x320
const ANIMACIONES = {
  rotar: {
    label: "🔄 Rotar",
    desc: "Giro completo 360°",
    // Rotación continua
    filter: "scale=320:320,rotate='2*PI*t/2.5':c=none:ow=320:oh=320"
  },
  zoom: {
    label: "🔍 Zoom In/Out",
    desc: "Acerca y aleja",
    filter: "scale=320:320,zoompan=z='if(lte(mod(on,30),15),1+0.03*mod(on,15),1.45-0.03*mod(on,15))':d=1:s=320x320:fps=12"
  },
  shake: {
    label: "🫨 Shake",
    desc: "Tiembla como gelatina",
    filter: "scale=320:320,crop=300:300:'10+5*sin(4*PI*t)':'10+5*cos(4*PI*t)',scale=320:320"
  },
  pulse: {
    label: "💓 Pulso",
    desc: "Palpita como corazón",
    filter: "scale=320:320,zoompan=z='1+0.1*abs(sin(2*PI*on/15))':d=1:s=320x320:fps=12"
  },
  fade: {
    label: "🌗 Fade",
    desc: "Aparece y desaparece",
    filter: "scale=320:320,fade=t=in:st=0:d=0.6:alpha=1,fade=t=out:st=1.9:d=0.6:alpha=1"
  },
  flip: {
    label: "🔁 Flip",
    desc: "Se voltea de lado",
    filter: "scale=320:320,hflip,scale=320:320"
  },
  glitch: {
    label: "⚡ Glitch",
    desc: "Efecto glitch",
    filter: "scale=320:320,hue=h='30*sin(6*PI*t)':s='1+0.3*sin(8*PI*t)'"
  },
  arcoiris: {
    label: "🌈 Arcoíris",
    desc: "Cambio de colores",
    filter: "scale=320:320,hue=h='360*t/2.5'"
  },
  bounce: {
    label: "🏀 Rebote",
    desc: "Sube y baja",
    filter: "scale=320:320,crop=320:300:0:'10+8*abs(sin(3*PI*t))',pad=320:320:0:0:color=0x00000000"
  },
  spin3d: {
    label: "🌀 Spin 3D",
    desc: "Giro estilo moneda",
    filter: "scale='320*abs(cos(2*PI*t/2.5))+1':320,pad=320:320:'(ow-iw)/2':0:color=0x00000000"
  },
  zoom_in: {
    label: "📈 Zoom In",
    desc: "Se acerca lento",
    filter: "scale=320:320,zoompan=z='1+0.5*on/30':d=1:s=320x320:fps=12"
  },
  zoom_out: {
    label: "📉 Zoom Out",
    desc: "Se aleja lento",
    filter: "scale=320:320,zoompan=z='1.5-0.5*on/30':d=1:s=320x320:fps=12"
  },
};

// ===== Convertir imagen a WebP animado con filtro FFmpeg =====
async function applyAnimation(inputPath, outputPath, animKey) {
  const anim = ANIMACIONES[animKey];
  if (!anim) throw new Error(`Animación desconocida: ${animKey}`);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions([
        "-loop", "1",
        "-t", "2.5",
      ])
      .outputOptions([
        "-vcodec", "libwebp",
        "-vf", `${anim.filter},format=yuva420p`,
        "-loop", "0",
        "-preset", "default",
        "-an",
        "-vsync", "0",
        "-pix_fmt", "yuva420p",
        "-q:v", "60",
      ])
      .toFormat("webp")
      .on("error", (err) => {
        console.error(`[anim] ffmpeg error (${animKey}):`, err.message);
        reject(err);
      })
      .on("end", resolve)
      .save(outputPath);
  });
}

// ===== Agregar metadata EXIF al webp =====
async function addExif(webpPath, packname, author) {
  const tmpIn = webpPath;
  const tmpOut = path.join(TMP_DIR, randomName("webp"));

  const json = {
    "sticker-pack-id": "suki-anim",
    "sticker-pack-name": packname,
    "sticker-pack-publisher": author,
    emojis: [""],
  };

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00,
    0x00, 0x00
  ]);

  const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
  const exif = Buffer.concat([exifAttr, jsonBuff]);
  exif.writeUIntLE(jsonBuff.length, 14, 4);

  const img = new webp.Image();
  await img.load(tmpIn);
  img.exif = exif;
  await img.save(tmpOut);

  return tmpOut;
}

// ===== Procesar y enviar sticker animado =====
async function procesarAnimacion(conn, job, animKey, triggerMsg) {
  const { chatId, keyword, safeKey, basePath, quotedBase, senderName } = job;
  job.isBusy = true;

  try {
    const anim = ANIMACIONES[animKey];
    if (!anim) throw new Error("Animación no encontrada.");

    await conn.sendMessage(chatId, { react: { text: "⏳", key: triggerMsg.key } });
    await conn.sendMessage(chatId, {
      text: `🎬 Aplicando animación *${anim.label}*...`
    }, { quoted: quotedBase });

    // Convertir webp base → PNG (para que FFmpeg lo entienda bien)
    const pngPath = path.join(TMP_DIR, randomName("png"));
    await new Promise((resolve, reject) => {
      ffmpeg(basePath)
        .outputOptions(["-vframes", "1"])
        .save(pngPath)
        .on("end", resolve)
        .on("error", reject);
    });

    // Aplicar animación
    const rawWebp = path.join(TMP_DIR, randomName("webp"));
    await applyAnimation(pngPath, rawWebp, animKey);

    // Agregar EXIF (metadata)
    const fecha = new Date();
    const fechaStr = `${fecha.getDate()}/${fecha.getMonth() + 1}/${fecha.getFullYear()}`;
    const finalWebp = await addExif(
      rawWebp,
      `✨ ${anim.label} — ${keyword}`,
      `🦋 La Suki Bot\n🎬 Animación: ${anim.label}\n📅 ${fechaStr}`
    );

    // Enviar sticker animado
    await conn.sendMessage(chatId, { sticker: { url: finalWebp } }, { quoted: quotedBase });
    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } });

    // Guardar una copia animada (opcional, para usar después con .sk)
    const savedPath = path.join(ANIM_DIR, `${safeKey}_${animKey}.webp`);
    try { fs.copyFileSync(finalWebp, savedPath); } catch {}

    // Limpiar temporales
    try { fs.unlinkSync(pngPath); } catch {}
    try { fs.unlinkSync(rawWebp); } catch {}
    try { fs.unlinkSync(finalWebp); } catch {}

  } catch (e) {
    console.error("[anim] error:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } });
    await conn.sendMessage(chatId, {
      text: `❌ Error al animar: \`${e.message}\``
    }, { quoted: quotedBase });
  } finally {
    job.isBusy = false;
  }
}

// ===== HANDLER PRINCIPAL =====
const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  const keyword = (args || []).join(" ").trim();
  if (!keyword) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *Indica la palabra clave del sticker.*

✳️ Uso:
*${pref}anim <palabra clave>*

Ejemplos:
• ${pref}anim hola
• ${pref}anim meme feliz

💡 Antes debes guardar el sticker con *${pref}guarsk*`,
    }, { quoted: msg });
  }

  const safeKey = sanitizeKey(keyword);
  const db = loadDB();
  const entry = db[safeKey];

  if (!entry || !fs.existsSync(entry.path)) {
    return conn.sendMessage(chatId, {
      text:
`⚠️ *No hay sticker guardado con esa palabra clave.*

🗝️ Buscado: \`${keyword}\`

Guárdalo primero con:
*${pref}guarsk ${keyword}* (respondiendo a un sticker)`,
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, { react: { text: "🎨", key: msg.key } });

  const usarBotones = botonesActivos();

  // 🎨 Caption con explicación
  const caption = usarBotones
    ? `
╭━━━━━━━━━━━━━━━━━━━━╮
   🎬 𝗔𝗡𝗜𝗠𝗔𝗗𝗢𝗥 𝗗𝗘 𝗦𝗧𝗜𝗖𝗞𝗘𝗥𝗦
╰━━━━━━━━━━━━━━━━━━━━╯

🗝️ *Sticker:* ${keyword}

━━━━━━━━━━━━━━━━━━━━
 *🎬 ELIGE UNA ANIMACIÓN*
━━━━━━━━━━━━━━━━━━━━

🟢 *OPCIÓN 1 — Menú de Botones*
Toca *📥 Menú de animaciones* abajo.

🔵 *OPCIÓN 2 — Responder número*
Cita este mensaje y escribe el número:
   *1*  →  🔄 Rotar
   *2*  →  🔍 Zoom In/Out
   *3*  →  🫨 Shake
   *4*  →  💓 Pulso
   *5*  →  🌗 Fade
   *6*  →  🔁 Flip
   *7*  →  ⚡ Glitch
   *8*  →  🌈 Arcoíris
   *9*  →  🏀 Rebote
   *10* →  🌀 Spin 3D
   *11* →  📈 Zoom In
   *12* →  📉 Zoom Out

━━━━━━━━━━━━━━━━━━━━
🤖 *La Suki Bot*
━━━━━━━━━━━━━━━━━━━━`.trim()
    : `
╭━━━━━━━━━━━━━━━━━━━━╮
   🎬 𝗔𝗡𝗜𝗠𝗔𝗗𝗢𝗥 𝗗𝗘 𝗦𝗧𝗜𝗖𝗞𝗘𝗥𝗦
╰━━━━━━━━━━━━━━━━━━━━╯

🗝️ *Sticker:* ${keyword}

━━━━━━━━━━━━━━━━━━━━
 *🎬 ELIGE UNA ANIMACIÓN*
━━━━━━━━━━━━━━━━━━━━

Cita este mensaje y escribe el número:
   *1*  →  🔄 Rotar
   *2*  →  🔍 Zoom In/Out
   *3*  →  🫨 Shake
   *4*  →  💓 Pulso
   *5*  →  🌗 Fade
   *6*  →  🔁 Flip
   *7*  →  ⚡ Glitch
   *8*  →  🌈 Arcoíris
   *9*  →  🏀 Rebote
   *10* →  🌀 Spin 3D
   *11* →  📈 Zoom In
   *12* →  📉 Zoom Out

━━━━━━━━━━━━━━━━━━━━
🤖 *La Suki Bot*
━━━━━━━━━━━━━━━━━━━━`.trim();

  // Mapeo de número → animación
  const NUMERO_ANIM = {
    "1":  "rotar",
    "2":  "zoom",
    "3":  "shake",
    "4":  "pulse",
    "5":  "fade",
    "6":  "flip",
    "7":  "glitch",
    "8":  "arcoiris",
    "9":  "bounce",
    "10": "spin3d",
    "11": "zoom_in",
    "12": "zoom_out",
  };

  // Menú de botones (lista desplegable)
  const nativeFlowButtons = [
    {
      text: "📥 Menú de animaciones",
      sections: [
        {
          title: "🎬 ANIMACIONES",
          highlight_label: "FX",
          rows: Object.entries(ANIMACIONES).map(([k, v]) => ({
            header: "",
            title: v.label,
            description: v.desc,
            id: `${pref}anim_${k}`,
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
        footer: "❦ La Suki Bot — Elige una animación ❦",
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

  // Guardar job pendiente
  pendingAnim[preview.key.id] = {
    chatId,
    keyword,
    safeKey,
    basePath: entry.path,
    quotedBase: msg,
    senderName: msg.pushName || "Usuario",
    isBusy: false,
    _createdAt: Date.now(),
  };

  setTimeout(() => {
    delete pendingAnim[preview.key.id];
  }, 10 * 60 * 1000);

  // Listener único
  if (!conn._animListener) {
    conn._animListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          // A) BOTONES / MENÚ INTERACTIVO
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
            if (!selectedId.includes("anim_")) continue;

            // Extraer key de animación (ej: .anim_rotar → rotar)
            const match = selectedId.match(/anim_([a-z0-9_]+)/i);
            if (!match) continue;
            const animKey = match[1].toLowerCase();
            if (!ANIMACIONES[animKey]) continue;

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

            await procesarAnimacion(conn, job, animKey, m);
            continue;
          }

          // B) RESPUESTAS CITADAS (número 1-12)
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
            const animKey = NUMERO_ANIM[firstWord];

            if (animKey && ANIMACIONES[animKey]) {
              if (job.isBusy) continue;
              await procesarAnimacion(conn, job, animKey, m);
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
handler.help = ["anim <palabra_clave>"];
handler.tags = ["stickers"];
module.exports = handler;
