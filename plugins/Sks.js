// plugins/sks.js
"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const ffmpeg = require("fluent-ffmpeg");
const webp = require("node-webpmux");

const TMP_DIR = path.resolve("./tmp");
const ACTIVOSS_FILE = path.resolve("./activoss.json");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const pendingSks = Object.create(null);

const STICKER_SIZE = 512;
const STICKER_FPS = 15;
const STICKER_DURATION = 3;

const EFFECTS = {
  original: {
    label: "✨ Original",
    desc: "Animación suave",
    filter: `zoompan=z='1.00+0.02*sin(on/8)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  zoom_in: {
    label: "🔍 Zoom In",
    desc: "Acercamiento animado",
    filter: `zoompan=z='1.00+0.004*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  zoom_out: {
    label: "🔭 Zoom Out",
    desc: "Alejar con movimiento",
    filter: `zoompan=z='1.18-0.003*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  rotate: {
    label: "🔄 Rotar",
    desc: "Rotación animada",
    filter: `rotate='0.18*sin(2*PI*t)':ow=rotw(iw):oh=roth(ih):c=none,fps=${STICKER_FPS},scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
  },
  flip_h: {
    label: "↔️ Voltear H",
    desc: "Horizontal + animación",
    filter: `hflip,zoompan=z='1.00+0.015*sin(on/10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  flip_v: {
    label: "↕️ Voltear V",
    desc: "Vertical + animación",
    filter: `vflip,zoompan=z='1.00+0.015*sin(on/10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  bounce: {
    label: "🪀 Bounce",
    desc: "Movimiento arriba/abajo",
    filter: `zoompan=z='1.02+0.02*sin(on/6)':x='iw/2-(iw/zoom/2)+10*sin(on/8)':y='ih/2-(ih/zoom/2)+8*cos(on/8)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  pulse: {
    label: "💓 Pulso",
    desc: "Latido suave",
    filter: `zoompan=z='1.00+0.03*sin(on/5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  round: {
    label: "🟣 Redondo",
    desc: "Corte circular",
    filter: `zoompan=z='1.00+0.01*sin(on/8)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(X-W/2,2)+pow(Y-H/2,2),pow(min(W,H)/2-6,2)),255,0)'`,
  },
  bn: {
    label: "⚫ B/N",
    desc: "Blanco y negro animado",
    filter: `hue=s=0,zoompan=z='1.00+0.02*sin(on/8)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  sepia: {
    label: "🟤 Sepia",
    desc: "Tono viejo / vintage",
    filter: `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,zoompan=z='1.00+0.02*sin(on/8)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  negativo: {
    label: "🌓 Negativo",
    desc: "Colores invertidos",
    filter: `negate,zoompan=z='1.00+0.02*sin(on/8)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
  arcoiris: {
    label: "🌈 Arcoíris",
    desc: "Cambio de tono animado",
    filter: `hue=h='sin(2*PI*t)*180':s=1.4,zoompan=z='1.00+0.02*sin(on/8)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${STICKER_FPS * STICKER_DURATION}:s=${STICKER_SIZE}x${STICKER_SIZE}:fps=${STICKER_FPS}`,
  },
};

const EFFECT_ORDER = [
  "original",
  "zoom_in",
  "zoom_out",
  "rotate",
  "flip_h",
  "flip_v",
  "bounce",
  "pulse",
  "round",
  "bn",
  "sepia",
  "negativo",
  "arcoiris",
];

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
  if (wa?.downloadContentFromMessage) return wa;
  if (conn?.wa?.downloadContentFromMessage) return conn.wa;
  if (global.wa?.downloadContentFromMessage) return global.wa;
  return null;
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

function randomFileName(ext) {
  return `${Crypto.randomBytes(6).toString("hex")}.${ext}`;
}

function extFromMime(mime = "") {
  const mt = String(mime).toLowerCase();
  if (mt.includes("png")) return "png";
  if (mt.includes("webp")) return "webp";
  if (mt.includes("gif")) return "gif";
  return "jpg";
}

async function downloadQuotedImage(WA, quoted) {
  const stream = await WA.downloadContentFromMessage(quoted.imageMessage, "image");
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

async function imageToAnimatedWebp(inputPath, outputPath, effectKey) {
  const effect = EFFECTS[effectKey];
  if (!effect) throw new Error("Efecto no válido.");

  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(["-loop 1"])
      .outputOptions([
        "-vf",
        effect.filter,
        "-vcodec",
        "libwebp",
        "-lossless",
        "0",
        "-q:v",
        "75",
        "-preset",
        "default",
        "-pix_fmt",
        "yuva420p",
        "-loop",
        "0",
        "-an",
        "-vsync",
        "0",
        "-t",
        String(STICKER_DURATION),
      ])
      .on("error", reject)
      .on("end", resolve)
      .save(outputPath);
  });
}

async function addExifSticker(webpFile, metadata = {}) {
  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  const json = {
    "sticker-pack-id": "sks-pack",
    "sticker-pack-name": metadata.packname || "La Suki Bot",
    "sticker-pack-publisher": metadata.author || "Russell XZ",
    emojis: metadata.categories || ["✨"],
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
  await img.load(webpFile);
  img.exif = exif;
  await img.save(tmpOut);

  return tmpOut;
}

function buildMenuText(pref, usarBotones) {
  const lines = EFFECT_ORDER.map((k, i) => `   *${i + 1}* → ${EFFECTS[k].label} — ${EFFECTS[k].desc}`).join("\n");
  return `
╭━━━━━━━━━━━━━━━━━━━━╮
   🎨 𝗦𝗞𝗦 𝗠𝗘𝗡𝗨 𝗗𝗘 𝗦𝗧𝗜𝗖𝗞𝗘𝗥
╰━━━━━━━━━━━━━━━━━━━━╯

🖼️ *Imagen recibida correctamente.*

${usarBotones ? "Toca un botón para elegir la animación." : "Responde con un número para elegir la animación."}

━━━━━━━━━━━━━━━━━━━━
${lines}
━━━━━━━━━━━━━━━━━━━━

💡 Uso:
*${pref}sks* (respondiendo a una imagen)
`.trim();
}

function effectFromText(text = "") {
  const t = String(text).trim().toLowerCase();
  const first = t.split(/\s+/)[0];

  const numMap = {
    "1": "original",
    "2": "zoom_in",
    "3": "zoom_out",
    "4": "rotate",
    "5": "flip_h",
    "6": "flip_v",
    "7": "bounce",
    "8": "pulse",
    "9": "round",
    "10": "bn",
    "11": "sepia",
    "12": "negativo",
    "13": "arcoiris",
  };

  if (numMap[first]) return numMap[first];

  const aliasMap = {
    original: "original",
    zoom: "zoom_in",
    "zoom in": "zoom_in",
    "zoom_in": "zoom_in",
    "zoomout": "zoom_out",
    "zoom out": "zoom_out",
    "zoom_out": "zoom_out",
    rotar: "rotate",
    rotate: "rotate",
    girar: "rotate",
    fliph: "flip_h",
    "flip h": "flip_h",
    "flip_h": "flip_h",
    volteoh: "flip_h",
    "flipv": "flip_v",
    "flip v": "flip_v",
    "flip_v": "flip_v",
    volteov: "flip_v",
    bounce: "bounce",
    pulso: "pulse",
    pulse: "pulse",
    redondo: "round",
    round: "round",
    bn: "bn",
    sepia: "sepia",
    negativo: "negativo",
    negative: "negativo",
    arcoiris: "arcoiris",
    "arcoíris": "arcoiris",
    rainbow: "arcoiris",
  };

  const compact = t.replace(/\s+/g, " ");
  return aliasMap[first] || aliasMap[compact] || "";
}

async function processStickerJob(conn, job, effectKey, triggerMsg) {
  const { chatId, inputFile, senderName, quotedBase, inputMime } = job;
  const pref = global.prefixes?.[0] || ".";
  const effect = EFFECTS[effectKey];

  if (!effect) {
    await conn.sendMessage(chatId, { text: "❌ Efecto no válido." }, { quoted: triggerMsg });
    return;
  }

  await conn.sendMessage(chatId, { react: { text: "🛠️", key: triggerMsg.key } }).catch(() => {});
  await conn.sendMessage(chatId, {
    text: `🎨 Creando sticker con *${effect.label}*...`,
  }, { quoted: quotedBase });

  const tmpOut = path.join(TMP_DIR, randomFileName("webp"));
  const exifPackName = `✨ Lo Mandó Hacer: ${senderName || "Usuario"}`;
  const exifAuthor = `🦋Bot Creador: ❦La Suki 3.0 Bot❦\n🛠️ Desarrollado por: Russell XZ 💻`;

  try {
    await imageToAnimatedWebp(inputFile, tmpOut, effectKey);

    const stickerWithExif = await addExifSticker(tmpOut, {
      packname: exifPackName,
      author: `${exifAuthor}\n📦 Efecto: ${effect.label}`,
      categories: ["✨"],
    });

    await conn.sendMessage(chatId, {
      sticker: fs.readFileSync(stickerWithExif),
    }, { quoted: quotedBase });

    await conn.sendMessage(chatId, { react: { text: "✅", key: triggerMsg.key } }).catch(() => {});
  } catch (e) {
    console.error("[sks] error:", e);
    await conn.sendMessage(chatId, { react: { text: "❌", key: triggerMsg.key } }).catch(() => {});
    await conn.sendMessage(chatId, {
      text: `❌ Error al crear el sticker: \`${e.message || e}\``,
    }, { quoted: quotedBase });
  } finally {
    try { fs.unlinkSync(tmpOut); } catch {}
    try { fs.unlinkSync(inputFile); } catch {}
    delete pendingSks[quotedBase?.key?.id];
  }
}

const handler = async (msg, { conn, wa }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quotedRaw = ctx?.quotedMessage;
  const quoted = quotedRaw ? unwrapMessage(quotedRaw) : null;

  if (!quoted?.imageMessage) {
    return conn.sendMessage(chatId, {
      text: `⚠️ *Responde a una imagen para crear el sticker.*\n\n✳️ Ejemplo:\n*${pref}sks* (respondiendo a una imagen)`,
    }, { quoted: msg });
  }

  const usarBotones = botonesActivos();

  try {
    await conn.sendMessage(chatId, { react: { text: "📥", key: msg.key } }).catch(() => {});

    const WA = ensureWA(wa, conn);
    if (!WA) throw new Error("No se pudo acceder a Baileys.");

    const imgBuffer = await downloadQuotedImage(WA, quoted);
    if (!imgBuffer.length) throw new Error("La imagen está vacía.");

    const mime = quoted.imageMessage.mimetype || "image/jpeg";
    const ext = extFromMime(mime);
    const inputFile = path.join(TMP_DIR, `${Date.now()}_${randomFileName(ext)}`);
    fs.writeFileSync(inputFile, imgBuffer);

    const senderName = msg.pushName || "Usuario";

    const menuText = buildMenuText(pref, usarBotones);

    let preview;
    if (usarBotones) {
      const nativeFlowButtons = [
        {
          text: "🎨 Elegir animación",
          sections: [
            {
              title: "🎞️ ANIMACIONES",
              highlight_label: ".sks",
              rows: EFFECT_ORDER.map((k, i) => ({
                header: "",
                title: `${i + 1}. ${EFFECTS[k].label}`,
                description: EFFECTS[k].desc,
                id: `${pref}sks_${k}`,
              })),
            },
          ],
        },
      ];

      try {
        preview = await conn.sendMessage(chatId, {
          text: menuText,
          footer: "❦ La Suki Bot",
          buttons: nativeFlowButtons,
          headerType: 1,
        }, { quoted: msg });
      } catch (e) {
        console.log("[sks] botones fallaron, fallback texto:", e.message);
        preview = await conn.sendMessage(chatId, { text: menuText }, { quoted: msg });
      }
    } else {
      preview = await conn.sendMessage(chatId, { text: menuText }, { quoted: msg });
    }

    pendingSks[preview.key.id] = {
      chatId,
      inputFile,
      inputMime: mime,
      senderName,
      quotedBase: msg,
      createdAt: Date.now(),
    };

    setTimeout(() => {
      const job = pendingSks[preview.key.id];
      if (job) {
        try { fs.unlinkSync(job.inputFile); } catch {}
        delete pendingSks[preview.key.id];
      }
    }, 10 * 60 * 1000);

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }).catch(() => {});
  } catch (err) {
    console.error("[sks] error:", err);
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }).catch(() => {});
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* \`${err.message || err}\``,
    }, { quoted: msg });
  }

  if (!conn._sksListener) {
    conn._sksListener = true;

    conn.ev.on("messages.upsert", async (ev) => {
      for (const m of ev.messages) {
        try {
          const interactiveReply =
            m.message?.interactiveResponseMessage?.nativeFlowResponseMessage ||
            m.message?.listResponseMessage ||
            m.message?.buttonsResponseMessage ||
            m.message?.templateButtonReplyMessage ||
            null;

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

          const ctxReply = m.message?.extendedTextMessage?.contextInfo;
          const cited = ctxReply?.stanzaId;

          let job = null;
          let jobKey = null;

          if (cited && pendingSks[cited]) {
            job = pendingSks[cited];
            jobKey = cited;
          } else {
            const latest = Object.entries(pendingSks)
              .filter(([, j]) => j.chatId === m.key.remoteJid)
              .sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0))[0];
            if (latest) {
              jobKey = latest[0];
              job = latest[1];
            }
          }

          if (!job) continue;

          let effectKey = "";
          if (selectedId) {
            const match = String(selectedId).match(/sks_([a-z0-9_]+)/i);
            if (match) effectKey = match[1].toLowerCase();
            else effectKey = effectFromText(selectedId);
          } else {
            const text = String(
              m.message?.conversation ||
              m.message?.extendedTextMessage?.text ||
              ""
            ).trim();
            effectKey = effectFromText(text);
          }

          if (!effectKey || !EFFECTS[effectKey]) continue;

          if (pendingSks[jobKey]?.busy) continue;
          pendingSks[jobKey].busy = true;

          await processStickerJob(conn, job, effectKey, m);
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
handler.register = true;

module.exports = handler;
