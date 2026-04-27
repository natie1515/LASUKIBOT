"use strict";

const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

// Evita registrar el evento varias veces si el plugin se recarga
let WELCOME_EVENT_STARTED = false;

// Cache global de admins por chat
const adminCache = {};

// ====== ARCHIVOS / ASSETS ======
const SETWELCOME_PATH = path.resolve("setwelcome.json");

const FALLBACK_PROFILE = "https://cdn.russellxz.click/e72cc417.jpeg";
const FALLBACK_GROUP = "https://cdn.russellxz.click/7177383b.jpg";

const WELCOME_BG = "https://cdn.russellxz.click/7177383b.jpg";
const BYE_BG = "https://cdn.russellxz.click/bc842c44.jpg";

const WELCOME_VIDEO = "https://cdn.russellxz.click/8e968c1d.mp4";
const BYE_VIDEO = "https://cdn.russellxz.click/6a4bd220.mp4";

// ====== HELPERS SEGUROS ======
function safeText(value = "") {
  if (typeof value === "undefined" || value === null) return "";
  return String(value);
}

function DIGITS(value = "") {
  return safeText(value).replace(/[^0-9]/g, "");
}

function isOn(value) {
  const v = safeText(value).trim().toLowerCase();

  return (
    value === true ||
    value === 1 ||
    v === "1" ||
    v === "true" ||
    v === "on" ||
    v === "si" ||
    v === "sí" ||
    v === "activar" ||
    v === "activado" ||
    v === "enable" ||
    v === "enabled"
  );
}

function getJidStr(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  return safeText(
    value.id ||
    value.jid ||
    value.lid ||
    value.phoneNumber ||
    value.user ||
    value._serialized ||
    ""
  );
}

function getParticipantsArray(metadata) {
  return Array.isArray(metadata?.participants) ? metadata.participants : [];
}

function isGroupJid(jid) {
  return safeText(jid).endsWith("@g.us");
}

function isRealJid(jid) {
  return safeText(jid).endsWith("@s.whatsapp.net");
}

function isLidJid(jid) {
  return safeText(jid).endsWith("@lid");
}

function normalizeOwnerNumber(value) {
  return DIGITS(Array.isArray(value) ? value[0] : value);
}

function isGlobalOwner(number) {
  const clean = DIGITS(number);
  if (!clean) return false;

  try {
    if (Array.isArray(global.owner)) {
      return global.owner.some(entry => normalizeOwnerNumber(entry) === clean);
    }
  } catch {}

  return false;
}

/**
 * Convierte participantes @lid a real jid si metadata tiene .jid
 */
function lidParser(participants = []) {
  try {
    return participants.map(p => {
      const id = getJidStr(p?.id || p);
      const real = getJidStr(p?.jid);

      return {
        id: isLidJid(id) && isRealJid(real) ? real : id,
        lid: isLidJid(id) ? id : "",
        jid: isRealJid(real) ? real : "",
        admin: p?.admin || null,
        raw: p
      };
    });
  } catch {
    return [];
  }
}

/**
 * Con metadata y cualquier JID devuelve:
 * {
 *   realJid,
 *   lidJid,
 *   number,
 *   mentionJid
 * }
 */
function resolveRealFromMeta(metadata, anyJid) {
  const out = {
    realJid: "",
    lidJid: "",
    number: "",
    mentionJid: ""
  };

  const safeJid = getJidStr(anyJid);
  const rawParticipants = getParticipantsArray(metadata);
  const parsed = lidParser(rawParticipants);

  if (!safeJid) return out;

  if (isRealJid(safeJid)) {
    out.realJid = safeJid;

    const foundRaw = rawParticipants.find(p => {
      const id = getJidStr(p?.id);
      const jid = getJidStr(p?.jid);
      return id === safeJid || jid === safeJid;
    });

    if (foundRaw) {
      const id = getJidStr(foundRaw?.id);
      if (isLidJid(id)) out.lidJid = id;
    }
  } else if (isLidJid(safeJid)) {
    out.lidJid = safeJid;

    const foundRaw = rawParticipants.find(p => getJidStr(p?.id) === safeJid);
    const real = getJidStr(foundRaw?.jid);

    if (isRealJid(real)) {
      out.realJid = real;
    } else {
      const foundParsed = parsed.find(p => p.lid === safeJid || p.raw?.id === safeJid);
      if (isRealJid(foundParsed?.id)) out.realJid = foundParsed.id;
    }
  } else {
    out.realJid = safeJid;
  }

  out.number = DIGITS(out.realJid || safeJid);
  out.mentionJid = out.realJid || out.lidJid || safeJid;

  return out;
}

function findParticipantInfo(metadata, jid) {
  const safeJid = getJidStr(jid);
  const rawParticipants = getParticipantsArray(metadata);

  return rawParticipants.find(p => {
    const id = getJidStr(p?.id);
    const real = getJidStr(p?.jid);
    return id === safeJid || real === safeJid;
  }) || null;
}

async function getConfigSafe(chatId, key) {
  try {
    return await getConfig(chatId, key);
  } catch (e) {
    console.log(`⚠️ No se pudo leer config ${key}:`, e.message);
    return 0;
  }
}

function readCustomMessages(chatId) {
  try {
    if (!fs.existsSync(SETWELCOME_PATH)) return {};

    const raw = fs.readFileSync(SETWELCOME_PATH, "utf-8");
    if (!raw.trim()) return {};

    const data = JSON.parse(raw);
    return data?.[chatId] || {};
  } catch (e) {
    console.log("⚠️ setwelcome.json inválido:", e.message);
    return {};
  }
}

async function getProfileUrl(conn, jid, chatId, fallback = FALLBACK_PROFILE) {
  const candidates = [
    getJidStr(jid),
    getJidStr(chatId)
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const url = await conn.profilePictureUrl(candidate, "image");
      if (url) return url;
    } catch {}
  }

  return fallback;
}

async function loadImageSafe(url, fallbackUrl) {
  try {
    return await loadImage(url);
  } catch {
    try {
      return await loadImage(fallbackUrl);
    } catch {
      return null;
    }
  }
}

async function makeWelcomeImage(profileUrl, bgUrl) {
  const canvas = createCanvas(1080, 720);
  const ctx = canvas.getContext("2d");

  const fondo = await loadImageSafe(bgUrl, FALLBACK_GROUP);
  const avatar = await loadImageSafe(profileUrl, FALLBACK_PROFILE);

  if (fondo) {
    ctx.drawImage(fondo, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#050816";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(150, 150, 85, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(avatar, 65, 65, 170, 170);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  return Buffer.from(canvas.toBuffer("image/png"));
}

async function safeSend(conn, chatId, payload) {
  try {
    return await conn.sendMessage(chatId, payload);
  } catch (e) {
    console.log("⚠️ No se pudo enviar mensaje en bienvenida/despedida:", e.message);
    return null;
  }
}

async function removeParticipantSafe(conn, chatId, participant, realJid, lidJid) {
  const candidates = [
    getJidStr(participant),
    getJidStr(realJid),
    getJidStr(lidJid)
  ].filter(Boolean);

  const unique = [...new Set(candidates)];

  for (const jid of unique) {
    try {
      await conn.groupParticipantsUpdate(chatId, [jid], "remove");
      return true;
    } catch (e) {
      console.log("⚠️ No se pudo expulsar con jid:", jid, e.message);
    }
  }

  return false;
}

function updateAdminCache(chatId, metadata) {
  try {
    adminCache[chatId] = new Set(
      getParticipantsArray(metadata)
        .filter(p => p?.admin === "admin" || p?.admin === "superadmin")
        .map(p => getJidStr(p?.id || p))
        .filter(Boolean)
    );
  } catch {
    adminCache[chatId] = new Set();
  }
}

// ====== MENSAJES ======
const mensajesBienvenida = [
  "🌟 ¡Bienvenid@ al grupo! Esperamos que la pases de lo mejor 🎉",
  "🎈 ¡Hola hola! Gracias por unirte, disfruta tu estadía ✨",
  "✨ ¡Nuevo miembro ha llegado! Que empiece la fiesta 🎊",
  "😯 ¡Hey! Te damos la bienvenida con los brazos abiertos 🤗",
  "💥 ¡Un guerrero más se une a la aventura! Bienvenid@ 😎"
];

const mensajesDespedida = [
  "😈 ¡Adiós! Esperamos verte de nuevo.",
  "😆 Se ha ido un miembro. ¡Buena suerte!",
  "🚪 Alguien ha salido del grupo. ¡Hasta luego!",
  "📤 Un compañero ha partido, ¡le deseamos lo mejor!",
  "💨 Se ha ido volando... ¡Bye bye!"
];

const arabes = [
  "20", "212", "213", "216", "218", "222", "224", "230", "234", "235", "237", "238", "249",
  "250", "251", "252", "253", "254", "255", "257", "258", "260", "263", "269", "960", "961",
  "962", "963", "964", "965", "966", "967", "968", "970", "971", "972", "973", "974", "975",
  "976", "980", "981", "992", "994", "995", "998"
];

// ====== HANDLER PRINCIPAL ======
const handler = async (conn) => {
  if (WELCOME_EVENT_STARTED) {
    console.log("♻️ Sistema de bienvenida/despedida ya estaba iniciado.");
    return;
  }

  WELCOME_EVENT_STARTED = true;
  console.log("✅ Sistema de bienvenida/despedida iniciado.");

  conn.ev.on("group-participants.update", async (update = {}) => {
    try {
      const chatId = getJidStr(update.id);
      if (!isGroupJid(chatId)) return;

      const action = safeText(update.action).toLowerCase();
      const participants = Array.isArray(update.participants) ? update.participants : [];

      if (!participants.length) return;

      const metadata = await conn.groupMetadata(chatId).catch(e => {
        console.log("⚠️ No se pudo cargar metadata del grupo:", e.message);
        return null;
      });

      if (!metadata) return;

      updateAdminCache(chatId, metadata);

      const welcomeActive = await getConfigSafe(chatId, "welcome");
      const byeActive = await getConfigSafe(chatId, "despedidas");
      const antiArabe = await getConfigSafe(chatId, "antiarabe");

      const personalizados = readCustomMessages(chatId);
      const bienvenidaPersonalizada = safeText(personalizados?.bienvenida).trim();
      const despedidaPersonalizada = safeText(personalizados?.despedida).trim();

      // ====== AVISOS DE ADMIN ======
      if (action === "promote" || action === "demote") {
        const actor = getJidStr(update.author);
        const actorResolved = resolveRealFromMeta(metadata, actor);
        const actorNum = actorResolved.number || DIGITS(actor) || "Desconocido";
        const actorMention = actorResolved.mentionJid || actor;

        for (const targetRaw of participants) {
          const target = getJidStr(targetRaw);
          if (!target) continue;

          const targetResolved = resolveRealFromMeta(metadata, target);
          const targetNum = targetResolved.number || DIGITS(target) || "Desconocido";
          const targetMention = targetResolved.mentionJid || target;

          const mentions = [targetMention, actorMention].filter(Boolean);

          if (action === "promote") {
            await safeSend(conn, chatId, {
              text:
`╭──『 👑 *NUEVO ADMIN* 』─◆
│ 👤 Usuario: @${targetNum}
│ ✅ Ascendido por: @${actorNum}
╰────────────────────◆`,
              mentions
            });
          }

          if (action === "demote") {
            await safeSend(conn, chatId, {
              text:
`╭──『 📉 *ADMIN DEGRADADO* 』─◆
│ 👤 Usuario: @${targetNum}
│ ❌ Degradado por: @${actorNum}
╰────────────────────◆`,
              mentions
            });
          }
        }

        const freshMeta = await conn.groupMetadata(chatId).catch(() => null);
        if (freshMeta) updateAdminCache(chatId, freshMeta);
        return;
      }

      // ====== BIENVENIDA / DESPEDIDA / ANTIÁRABE ======
      for (const pRaw of participants) {
        const participant = getJidStr(pRaw);
        if (!participant) continue;

        const resolved = resolveRealFromMeta(metadata, participant);
        const realJid = resolved.realJid;
        const lidJid = resolved.lidJid;
        const mentionId = resolved.mentionJid || realJid || lidJid || participant;
        const number = resolved.number || DIGITS(participant);
        const mention = number ? `@${number}` : "@usuario";

        if (action === "add") {
          // ====== ANTIÁRABE ======
          const isArabic = isOn(antiArabe) && number && arabes.some(cc => number.startsWith(cc));

          if (isArabic) {
            const info =
              findParticipantInfo(metadata, realJid) ||
              findParticipantInfo(metadata, lidJid) ||
              findParticipantInfo(metadata, participant);

            const isAdmin = info?.admin === "admin" || info?.admin === "superadmin";
            const isOwner = isGlobalOwner(number);

            if (!isAdmin && !isOwner) {
              await safeSend(conn, chatId, {
                text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
                mentions: [mentionId]
              });

              await removeParticipantSafe(conn, chatId, participant, realJid, lidJid);
              continue;
            }
          }

          if (!isOn(welcomeActive)) continue;

          const profileTarget = realJid || lidJid || participant;
          const perfilURL = await getProfileUrl(conn, profileTarget, chatId, FALLBACK_PROFILE);

          if (bienvenidaPersonalizada) {
            await safeSend(conn, chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}\n\n${bienvenidaPersonalizada}`,
              mentions: [mentionId]
            });
          } else {
            const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await safeSend(conn, chatId, {
                video: { url: WELCOME_VIDEO },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            } else {
              const buffer = await makeWelcomeImage(perfilURL, WELCOME_BG);

              await safeSend(conn, chatId, {
                image: buffer,
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            }
          }
        }

        if (action === "remove") {
          if (!isOn(byeActive)) continue;

          const profileTarget = realJid || lidJid || participant;
          const perfilURL = await getProfileUrl(conn, profileTarget, chatId, FALLBACK_PROFILE);

          if (despedidaPersonalizada) {
            await safeSend(conn, chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}\n\n${despedidaPersonalizada}`,
              mentions: [mentionId]
            });
          } else {
            const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await safeSend(conn, chatId, {
                video: { url: BYE_VIDEO },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            } else {
              const buffer = await makeWelcomeImage(perfilURL, BYE_BG);

              await safeSend(conn, chatId, {
                image: buffer,
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            }
          }
        }
      }

      const newMeta = await conn.groupMetadata(chatId).catch(() => null);
      if (newMeta) updateAdminCache(chatId, newMeta);
    } catch (err) {
      console.error("❌ Error en lógica de grupo:", err);
    }
  });
};

handler.run = handler;
module.exports = handler;
