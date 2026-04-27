const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

// Cache global de admins por chat
const adminCache = {};

// ==== HELPERS LID/REAL ====
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

function isActive(value) {
  const v = String(value ?? "").trim().toLowerCase();

  return (
    value === 1 ||
    value === true ||
    v === "1" ||
    v === "on" ||
    v === "true" ||
    v === "activar" ||
    v === "activado" ||
    v === "enabled" ||
    v === "enable" ||
    v === "si" ||
    v === "sí"
  );
}

function getConfigSafe(chatId, key, fallback = 0) {
  try {
    const value = getConfig(chatId, key);
    return value ?? fallback;
  } catch (e) {
    console.log(`⚠️ Error leyendo config ${key} para ${chatId}:`, e.message);
    return fallback;
  }
}

function safeJsonRead(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;

    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;

    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : fallback;
  } catch (e) {
    console.log("⚠️ Error leyendo JSON:", file, e.message);
    return fallback;
  }
}

// ✅ Convierte cualquier cosa a texto JID seguro.
// Soporta string, objeto de Baileys, LID, JID real, pn, jid, id, etc.
function getJidStr(obj) {
  if (!obj) return "";

  if (typeof obj === "string") {
    if (obj === "[object Object]") return "";
    return obj;
  }

  if (typeof obj === "number") return String(obj);

  if (typeof obj === "object") {
    return String(
      obj.jid ||
      obj.id ||
      obj.lid ||
      obj.pn ||
      obj.phoneNumber ||
      obj.participant ||
      obj.user ||
      obj._serialized ||
      ""
    );
  }

  return "";
}

function cleanJid(jid = "") {
  jid = getJidStr(jid).trim();

  if (!jid) return "";

  if (jid.includes(":") && jid.includes("@s.whatsapp.net")) {
    const num = jid.split(":")[0].replace(/[^0-9]/g, "");
    return num ? `${num}@s.whatsapp.net` : jid;
  }

  return jid;
}

function jidNumber(jid = "") {
  const text = cleanJid(jid);
  return DIGITS(text.split(":")[0]);
}

function makeRealJid(number = "") {
  const n = DIGITS(number);
  return n ? `${n}@s.whatsapp.net` : "";
}

function getParticipantCandidates(value) {
  const out = [];

  function add(v) {
    const text = cleanJid(v);
    if (text && text !== "[object Object]" && !out.includes(text)) out.push(text);
  }

  if (!value) return out;

  if (typeof value === "string" || typeof value === "number") {
    add(value);
    return out;
  }

  if (typeof value === "object") {
    add(value.jid);
    add(value.id);
    add(value.lid);
    add(value.pn);
    add(value.phoneNumber);
    add(value.participant);
    add(value.user);
    add(value._serialized);

    const n = DIGITS(value.phoneNumber || value.pn || value.user || "");
    if (n) add(makeRealJid(n));
  }

  return out;
}

/** Si id es @lid y existe .jid real, usa el real */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (
        typeof v?.id === "string" &&
        v.id.endsWith("@lid") &&
        typeof v?.jid === "string" &&
        v.jid.endsWith("@s.whatsapp.net")
      ) ? v.jid : getJidStr(v),
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch {
    return participants || [];
  }
}

/** Con metadata y un JID real/LID/objeto → { realJid, lidJid, number } */
function resolveRealFromMeta(meta, anyJid) {
  const out = {
    realJid: null,
    lidJid: null,
    number: null
  };

  const raw = Array.isArray(meta?.participants) ? meta.participants : [];
  const norm = lidParser(raw);

  const candidates = getParticipantCandidates(anyJid);

  // Resolver directo por candidates
  for (const c of candidates) {
    if (c.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(c);
      out.number = jidNumber(c);
    }

    if (c.endsWith("@lid")) {
      out.lidJid = c;
    }
  }

  // Resolver usando global.lidMap si existe
  try {
    if (global.lidMap instanceof Map) {
      for (const c of candidates) {
        const resolved = global.lidMap.get(c);

        if (resolved && String(resolved).endsWith("@s.whatsapp.net")) {
          out.realJid = cleanJid(resolved);
          out.number = jidNumber(resolved);
        }
      }
    }
  } catch {}

  // Buscar en metadata
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i] || {};
    const rawIds = getParticipantCandidates(p);
    const normId = cleanJid(norm[i]?.id || "");

    const allIds = [
      ...rawIds,
      normId
    ].filter(Boolean);

    const match = candidates.some(c => allIds.includes(c));

    if (!match) continue;

    for (const id of allIds) {
      if (id.endsWith("@s.whatsapp.net")) {
        out.realJid = cleanJid(id);
        out.number = jidNumber(id);
      }

      if (id.endsWith("@lid")) {
        out.lidJid = id;
      }
    }

    if (typeof p?.jid === "string" && p.jid.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(p.jid);
      out.number = jidNumber(p.jid);
    }

    if (typeof p?.id === "string" && p.id.endsWith("@lid")) {
      out.lidJid = p.id;
    }

    break;
  }

  // Último fallback: extraer número de cualquier candidate
  if (!out.number) {
    for (const c of candidates) {
      const n = jidNumber(c);
      if (n) {
        out.number = n;
        if (!out.realJid && c.endsWith("@s.whatsapp.net")) {
          out.realJid = makeRealJid(n);
        }
        break;
      }
    }
  }

  return out;
}

function findParticipantInfo(meta, anyJid) {
  const raw = Array.isArray(meta?.participants) ? meta.participants : [];
  const candidates = getParticipantCandidates(anyJid);

  for (const p of raw) {
    const ids = getParticipantCandidates(p);

    if (candidates.some(c => ids.includes(c))) {
      return p;
    }
  }

  return null;
}

function isOwnerNumber(number) {
  const clean = DIGITS(number);
  if (!clean) return false;

  if (typeof global.isOwner === "function") {
    try {
      if (global.isOwner(clean)) return true;
      if (global.isOwner(`${clean}@s.whatsapp.net`)) return true;
    } catch {}
  }

  return Array.isArray(global.owner) && global.owner.some(function(entry) {
    if (Array.isArray(entry)) {
      return entry.some(x => DIGITS(x) === clean);
    }

    return DIGITS(entry) === clean;
  });
}

async function getProfileUrl(conn, userJid, chatId, fallback) {
  const tries = [
    cleanJid(userJid),
    chatId
  ].filter(Boolean);

  for (const jid of tries) {
    try {
      const url = await conn.profilePictureUrl(jid, "image");
      if (url) return url;
    } catch {}
  }

  return fallback;
}

async function loadImageSafe(url, fallbackUrl) {
  try {
    return await loadImage(url);
  } catch {
    return await loadImage(fallbackUrl);
  }
}

async function sendWelcomeImage(conn, chatId, perfilURL, caption, mentions) {
  const fallbackAvatar = "https://cdn.russellxz.click/e72cc417.jpeg";
  const avatar = await loadImageSafe(perfilURL, fallbackAvatar);
  const fondo = await loadImage("https://cdn.russellxz.click/7177383b.jpg");

  const canvas = createCanvas(1080, 720);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(fondo, 0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.beginPath();
  ctx.arc(150, 150, 85, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(avatar, 65, 65, 170, 170);
  ctx.restore();

  ctx.globalAlpha = 1.0;

  await conn.sendMessage(chatId, {
    image: Buffer.from(canvas.toBuffer("image/png")),
    caption,
    mentions
  });
}

async function sendByeImage(conn, chatId, perfilURL, caption, mentions) {
  const fallbackAvatar = "https://cdn.russellxz.click/7177383b.jpg";
  const avatar = await loadImageSafe(perfilURL, fallbackAvatar);
  const fondo = await loadImage("https://cdn.russellxz.click/bc842c44.jpg");

  const canvas = createCanvas(1080, 720);
  const ctx = canvas.getContext("2d");

  ctx.drawImage(fondo, 0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.beginPath();
  ctx.arc(150, 150, 85, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(avatar, 65, 65, 170, 170);
  ctx.restore();

  ctx.globalAlpha = 1.0;

  await conn.sendMessage(chatId, {
    image: Buffer.from(canvas.toBuffer("image/png")),
    caption,
    mentions
  });
}
// ==== FIN HELPERS ====

const handler = async (conn) => {
  if (!conn?.ev?.on) {
    console.log("❌ Welcome/despedidas: conn.ev.on no disponible.");
    return;
  }

  // Evita registrar el listener muchas veces si el loader recarga plugins
  if (conn.__sukiWelcomeOldListenerStarted) {
    console.log("♻️ Listener viejo de bienvenidas/despedidas ya estaba activo.");
    return;
  }

  conn.__sukiWelcomeOldListenerStarted = true;

  conn.ev.on("group-participants.update", async (update) => {
    try {
      const chatId = cleanJid(update?.id || "");
      const action = String(update?.action || "").toLowerCase();

      if (!chatId || !chatId.endsWith("@g.us")) return;

      const participants = Array.isArray(update?.participants)
        ? update.participants
        : [];

      if (!participants.length) {
        console.log("⚠️ group-participants.update sin participants:", update);
        return;
      }

      if (!["add", "remove", "promote", "demote"].includes(action)) {
        return;
      }

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("👥 EVENTO DE PARTICIPANTES");
      console.log("➡️ Grupo:", chatId);
      console.log("➡️ Acción:", action);
      console.log("➡️ Participantes:", participants.length);

      const metadata = await conn.groupMetadata(chatId).catch((e) => {
        console.log("⚠️ No se pudo leer metadata del grupo:", e.message);
        return null;
      });

      if (!metadata) return;

      // Actualizar Cache de Admins Inicial
      if (!adminCache[chatId]) {
        adminCache[chatId] = new Set(
          metadata.participants
            .filter(p => p.admin === "admin" || p.admin === "superadmin")
            .map(p => cleanJid(getJidStr(p)))
            .filter(Boolean)
        );
      }

      // ✅ FIX IMPORTANTE:
      // getConfig() en tu db.js es síncrono. No se puede usar .catch() directo.
      const welcomeActive = getConfigSafe(chatId, "welcome", 0);
      const byeActive = getConfigSafe(chatId, "despedidas", 0);
      const antiArabe = getConfigSafe(chatId, "antiarabe", 0);

      console.log("⚙️ Config welcome:", welcomeActive);
      console.log("⚙️ Config despedidas:", byeActive);
      console.log("⚙️ Config antiarabe:", antiArabe);

      const setwelcomePath = path.resolve("setwelcome.json");
      const setwelcomeData = safeJsonRead(setwelcomePath, {});
      const personalizados = setwelcomeData[chatId] || {};

      const bienvenidaPersonalizada = personalizados?.bienvenida;
      const despedidaPersonalizada = personalizados?.despedida;

      const mensajesBienvenida = [
        "🌟 ¡Bienvenid@ al grupo! Esperamos que la pases de lo mejor 🎉",
        "🎈 ¡Hola hola! Gracias por unirte, disfruta tu estadía✨️",
        "✨ ¡Nuevo miembro ha llegado! Que empiece la fiesta 🎊",
        "😯 ¡Hey! Te damos la bienvenida con los brazos abiertos🤗",
        "💥 ¡Un guerrero más se une a la aventura! Bienvenid@ 😎"
      ];

      const mensajesDespedida = [
        "😈 ¡Adiós! Esperamos de nuevo.",
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

      // 🔰 SISTEMA DE AVISO DE CAMBIOS DE ADMIN
      if (action === "promote" || action === "demote") {
        const actor = cleanJid(update?.author || update?.authorPn || "");
        const actorNum = actor ? DIGITS(actor) : "Desconocido";
        const actorMention = actor || null;

        for (const targetRaw of participants) {
          const target = cleanJid(getJidStr(targetRaw));
          const resolved = resolveRealFromMeta(metadata, targetRaw);
          const targetMention = resolved.realJid || resolved.lidJid || target;
          const targetNum = resolved.number || jidNumber(targetMention) || "Desconocido";

          if (!targetMention) continue;

          const mencionesEfectivas = [
            targetMention,
            actorMention
          ].filter(Boolean).map(String);

          if (action === "promote") {
            const texto =
`╭──『 👑 *NUEVO ADMIN* 』─◆
│ 👤 Usuario: @${targetNum}
│ ✅ Ascendido por: @${actorNum}
╰────────────────────◆`;

            await conn.sendMessage(chatId, {
              text: texto,
              mentions: mencionesEfectivas
            });
          }

          if (action === "demote") {
            const texto =
`╭──『 📉 *ADMIN DEGRADADO* 』─◆
│ 👤 Usuario: @${targetNum}
│ ❌ Degradado por: @${actorNum}
╰────────────────────◆`;

            await conn.sendMessage(chatId, {
              text: texto,
              mentions: mencionesEfectivas
            });
          }
        }

        return;
      }

      // 🔄 SISTEMA DE BIENVENIDAS, DESPEDIDAS Y ANTIÁRABE
      for (const pRaw of participants) {
        const participant = cleanJid(getJidStr(pRaw));
        const resolved = resolveRealFromMeta(metadata, pRaw);

        const mentionId = String(
          resolved.realJid ||
          resolved.lidJid ||
          participant ||
          ""
        );

        if (!mentionId) {
          console.log("⚠️ Participante sin JID válido. Ignorado:", pRaw);
          continue;
        }

        const phoneForMention =
          resolved.number ||
          jidNumber(mentionId) ||
          DIGITS(participant) ||
          "usuario";

        const mention = phoneForMention === "usuario"
          ? "@usuario"
          : `@${phoneForMention}`;

        if (action === "add") {
          const isArabic =
            isActive(antiArabe) &&
            resolved.number &&
            arabes.some(cc => resolved.number.startsWith(cc));

          if (isArabic) {
            const info = findParticipantInfo(metadata, pRaw);
            const isAdmin = info?.admin === "admin" || info?.admin === "superadmin";
            const isOwner = isOwnerNumber(resolved.number);

            if (!isAdmin && !isOwner) {
              await conn.sendMessage(chatId, {
                text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
                mentions: [mentionId]
              });

              try {
                await conn.groupParticipantsUpdate(chatId, [mentionId], "remove");
              } catch (e1) {
                try {
                  if (participant && participant !== mentionId) {
                    await conn.groupParticipantsUpdate(chatId, [participant], "remove");
                  }
                } catch (e2) {
                  console.log("⚠️ No se pudo expulsar antiárabe:", e2.message);
                }
              }

              continue;
            }
          }

          if (!isActive(welcomeActive)) {
            console.log("ℹ️ Welcome apagado para:", chatId);
            continue;
          }

          const perfilURL = await getProfileUrl(
            conn,
            resolved.realJid || mentionId,
            chatId,
            "https://cdn.russellxz.click/e72cc417.jpeg"
          );

          if (bienvenidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}\n\n${bienvenidaPersonalizada}`,
              mentions: [mentionId]
            });
          } else {
            const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            } else {
              await sendWelcomeImage(
                conn,
                chatId,
                perfilURL,
                `👋 ${mention}\n\n${mensaje}`,
                [mentionId]
              );
            }
          }

          console.log("✅ Bienvenida enviada a:", mentionId);
        }

        if (action === "remove") {
          if (!isActive(byeActive)) {
            console.log("ℹ️ Despedidas apagado para:", chatId);
            continue;
          }

          const perfilURL = await getProfileUrl(
            conn,
            resolved.realJid || mentionId,
            chatId,
            "https://cdn.russellxz.click/7177383b.jpg"
          );

          if (despedidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}\n\n${despedidaPersonalizada}`,
              mentions: [mentionId]
            });
          } else {
            const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            } else {
              await sendByeImage(
                conn,
                chatId,
                perfilURL,
                `👋 ${mention}\n\n${mensaje}`,
                [mentionId]
              );
            }
          }

          console.log("✅ Despedida enviada a:", mentionId);
        }
      }

      // Actualizar Cache de Admins Final
      const newMeta = await conn.groupMetadata(chatId).catch(() => null);

      if (newMeta) {
        adminCache[chatId] = new Set(
          newMeta.participants
            .filter(p => p.admin === "admin" || p.admin === "superadmin")
            .map(p => cleanJid(getJidStr(p)))
            .filter(Boolean)
        );
      }

    } catch (err) {
      console.error("❌ Error en lógica de grupo:", err);
    }
  });

  console.log("✅ Listener viejo de bienvenidas/despedidas cargado correctamente.");
};

handler.run = handler;
module.exports = handler;
