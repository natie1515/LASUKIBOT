const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

// OJO: antes tenías /D/g y eso está mal. Debe ser /\D/g
const DIGITS = function (s) {
  return String(s || "").replace(/\D/g, "");
};

function isLidJid(j) {
  return typeof j === "string" && j.endsWith("@lid");
}

function isUserJid(j) {
  return typeof j === "string" && j.endsWith("@s.whatsapp.net");
}

function isGroupJid(j) {
  return typeof j === "string" && j.endsWith("@g.us");
}

function fixJid(jid) {
  if (!jid) return "";
  jid = String(jid);

  // quitar device/agent: 12345:99@s.whatsapp.net => 12345@s.whatsapp.net
  if (jid.includes("@")) {
    const parts = jid.split("@");
    const user = parts[0].split(":")[0];
    return user + "@" + parts[1];
  }

  return jid;
}

function pnFromDigits(num) {
  num = DIGITS(num);
  return num ? num + "@s.whatsapp.net" : "";
}

function jidNumber(jid) {
  return DIGITS(String(jid || "").split("@")[0].split(":")[0]);
}

function sameUser(a, b) {
  if (!a || !b) return false;

  a = fixJid(a);
  b = fixJid(b);

  if (a === b) return true;

  const da = jidNumber(a);
  const db = jidNumber(b);

  return !!da && !!db && da === db;
}

function normalizeRawParticipant(raw) {
  // Baileys viejo puede mandar string
  if (typeof raw === "string") {
    // En algunos builds rotos llega "[object Object]"; eso no sirve.
    if (raw === "[object Object]") {
      return {
        id: "",
        phoneNumber: "",
        lid: "",
        raw
      };
    }

    // Si llega JSON stringificado
    if (raw.trim().startsWith("{")) {
      try {
        const obj = JSON.parse(raw);
        return normalizeRawParticipant(obj);
      } catch (e) {}
    }

    return {
      id: fixJid(raw),
      phoneNumber: isUserJid(raw) ? fixJid(raw) : "",
      lid: isLidJid(raw) ? fixJid(raw) : "",
      raw
    };
  }

  // Baileys nuevo manda objeto GroupParticipant / Contact
  if (raw && typeof raw === "object") {
    const id = fixJid(
      raw.id ||
      raw.jid ||
      raw.participant ||
      raw.lid ||
      raw.phoneNumber ||
      raw.pn ||
      ""
    );

    let phoneNumber = fixJid(raw.phoneNumber || raw.pn || raw.jid || "");
    let lid = fixJid(raw.lid || "");

    if (phoneNumber && !isUserJid(phoneNumber)) {
      const n = DIGITS(phoneNumber);
      phoneNumber = n ? pnFromDigits(n) : "";
    }

    if (id && isUserJid(id) && !phoneNumber) phoneNumber = id;
    if (id && isLidJid(id) && !lid) lid = id;

    return {
      id,
      phoneNumber,
      lid,
      admin: raw.admin || null,
      isAdmin: raw.isAdmin || false,
      isSuperAdmin: raw.isSuperAdmin || false,
      username: raw.username || "",
      notify: raw.notify || "",
      name: raw.name || "",
      raw
    };
  }

  return {
    id: "",
    phoneNumber: "",
    lid: "",
    raw
  };
}

function findInMeta(info, metaParticipants) {
  if (!Array.isArray(metaParticipants)) return null;

  return metaParticipants.find(function (p) {
    if (!p) return false;

    const pId = fixJid(p.id || "");
    const pPn = fixJid(p.phoneNumber || p.pn || p.jid || "");
    const pLid = fixJid(p.lid || "");

    return (
      sameUser(pId, info.id) ||
      sameUser(pId, info.phoneNumber) ||
      sameUser(pId, info.lid) ||
      sameUser(pPn, info.id) ||
      sameUser(pPn, info.phoneNumber) ||
      sameUser(pPn, info.lid) ||
      sameUser(pLid, info.id) ||
      sameUser(pLid, info.phoneNumber) ||
      sameUser(pLid, info.lid)
    );
  }) || null;
}

async function getPnFromLid(conn, lid) {
  if (!lid || !isLidJid(lid)) return "";

  try {
    if (
      conn &&
      conn.signalRepository &&
      conn.signalRepository.lidMapping &&
      typeof conn.signalRepository.lidMapping.getPNForLID === "function"
    ) {
      const pn = await conn.signalRepository.lidMapping.getPNForLID(lid);
      if (pn && isUserJid(pn)) return fixJid(pn);
    }
  } catch (e) {}

  if (global.lidMap instanceof Map) {
    const pn = global.lidMap.get(lid);
    if (pn && isUserJid(pn)) return fixJid(pn);
  }

  return "";
}

async function normalizeParticipant(conn, raw, metaParticipants) {
  const info = normalizeRawParticipant(raw);

  const fromMeta = findInMeta(info, metaParticipants);
  if (fromMeta) {
    const metaId = fixJid(fromMeta.id || "");
    const metaPn = fixJid(fromMeta.phoneNumber || fromMeta.pn || fromMeta.jid || "");
    const metaLid = fixJid(fromMeta.lid || "");

    if (!info.id && metaId) info.id = metaId;
    if (!info.phoneNumber && metaPn && isUserJid(metaPn)) info.phoneNumber = metaPn;
    if (!info.lid && metaLid && isLidJid(metaLid)) info.lid = metaLid;

    if (!info.admin && fromMeta.admin) info.admin = fromMeta.admin;
    if (!info.isAdmin && fromMeta.isAdmin) info.isAdmin = fromMeta.isAdmin;
    if (!info.isSuperAdmin && fromMeta.isSuperAdmin) info.isSuperAdmin = fromMeta.isSuperAdmin;
  }

  // Si viene LID, intenta resolver PN usando el store oficial de Baileys o global.lidMap
  if (!info.phoneNumber && info.lid) {
    const pn = await getPnFromLid(conn, info.lid);
    if (pn) info.phoneNumber = pn;
  }

  if (!info.lid && info.id && isLidJid(info.id)) info.lid = info.id;
  if (!info.phoneNumber && info.id && isUserJid(info.id)) info.phoneNumber = info.id;

  // Para mencionar, mejor usar PN si existe; si no, usar LID/id
  info.mentionJid = info.phoneNumber || info.id || info.lid;

  // Para operaciones de grupo, usar el ID real que vino del evento primero
  info.groupJid = info.id || info.lid || info.phoneNumber || info.mentionJid;

  // Número visible: preferir PN. Si solo hay LID, mostrará los dígitos del LID.
  info.number = jidNumber(info.phoneNumber || info.mentionJid || info.groupJid);
  info.tag = info.number ? "@" + info.number : "@usuario";

  info.isAdminFinal =
    info.admin === "admin" ||
    info.admin === "superadmin" ||
    info.isAdmin === true ||
    info.isSuperAdmin === true;

  return info;
}

async function normalizeActor(conn, update, metaParticipants) {
  const actorRaw = update.author || update.authorPn || update.authorUsername || "";
  const actorInfo = await normalizeParticipant(conn, {
    id: update.author || "",
    phoneNumber: update.authorPn || "",
    username: update.authorUsername || ""
  }, metaParticipants);

  if (!actorInfo.mentionJid && actorRaw) {
    actorInfo.mentionJid = actorRaw;
  }

  return actorInfo;
}

async function safeProfilePicture(conn, jid, chatId) {
  try {
    if (jid) return await conn.profilePictureUrl(jid, "image");
  } catch (e) {}

  try {
    return await conn.profilePictureUrl(chatId, "image");
  } catch (e) {}

  return "https://cdn.russellxz.click/e72cc417.jpeg";
}

async function sendSafe(conn, chatId, content) {
  try {
    await conn.sendMessage(chatId, content);
  } catch (e) {
    console.error("[welcome] Error enviando mensaje:", e);
  }
}

var handler = async function (conn) {
  // Guarda mappings LID <-> PN cuando Baileys los reporte
  if (!conn.__sukiLidMappingListener) {
    conn.__sukiLidMappingListener = true;

    conn.ev.on("lid-mapping.update", function (data) {
      try {
        if (!global.lidMap) global.lidMap = new Map();

        const lid = fixJid(data && (data.lid || data.id || ""));
        const pn = fixJid(data && (data.pn || data.phoneNumber || ""));

        if (lid && pn && isLidJid(lid) && isUserJid(pn)) {
          global.lidMap.set(lid, pn);
        }
      } catch (e) {}
    });
  }

  if (conn.__sukiWelcomeListener) return;
  conn.__sukiWelcomeListener = true;

  conn.ev.on("group-participants.update", async function (update) {
    try {
      const chatId = update.id;
      if (!isGroupJid(chatId)) return;

      const action = update.action;
      const rawParticipants = Array.isArray(update.participants) ? update.participants : [];

      if (!rawParticipants.length) return;

      let metadata;
      try {
        metadata = await conn.groupMetadata(chatId);
      } catch (e) {
        console.error("[welcome] No se pudo obtener metadata:", e);
        return;
      }

      const metaParts = Array.isArray(metadata && metadata.participants)
        ? metadata.participants
        : [];

      const welcomeActive = await getConfig(chatId, "welcome");
      const byeActive = await getConfig(chatId, "despedidas");
      const antiArabe = await getConfig(chatId, "antiarabe");

      const setwelcomePath = path.resolve("setwelcome.json");
      let personalizados = {};

      if (fs.existsSync(setwelcomePath)) {
        try {
          const swData = JSON.parse(fs.readFileSync(setwelcomePath, "utf-8"));
          personalizados = swData[chatId] || {};
        } catch (e) {
          personalizados = {};
        }
      }

      const bienvenidaPersonalizada = personalizados.bienvenida || null;
      const despedidaPersonalizada = personalizados.despedida || null;

      const mensajesBienvenida = [
        "🌟 ¡Bienvenid@ al grupo! Esperamos que la pases de lo mejor 🎉",
        "🎈 ¡Hola hola! Gracias por unirte, disfruta tu estadía ✨️",
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

      const actorInfo = await normalizeActor(conn, update, metaParts);

      // ============================================================
      // PROMOTE: alguien fue ascendido a admin
      // ============================================================
      if (action === "promote") {
        for (let i = 0; i < rawParticipants.length; i++) {
          const targetInfo = await normalizeParticipant(conn, rawParticipants[i], metaParts);
          if (!targetInfo.mentionJid) continue;

          const mentions = [targetInfo.mentionJid];
          if (actorInfo.mentionJid) mentions.push(actorInfo.mentionJid);

          const texto =
            "╭──『 👑 *NUEVO ADMIN* 』─◆\n" +
            "│ 👤 Nuevo admin: " + targetInfo.tag + "\n" +
            (actorInfo.number ? "│ ✅ Ascendido por: @" + actorInfo.number + "\n" : "") +
            "╰────────────────────◆";

          await sendSafe(conn, chatId, {
            text: texto,
            mentions
          });
        }

        return;
      }

      // ============================================================
      // DEMOTE: alguien fue removido como admin
      // ============================================================
      if (action === "demote") {
        for (let i = 0; i < rawParticipants.length; i++) {
          const targetInfo = await normalizeParticipant(conn, rawParticipants[i], metaParts);
          if (!targetInfo.mentionJid) continue;

          const mentions = [targetInfo.mentionJid];
          if (actorInfo.mentionJid) mentions.push(actorInfo.mentionJid);

          const texto =
            "╭──『 ⬇️ *ADMIN REMOVIDO* 』─◆\n" +
            "│ 👤 Usuario: " + targetInfo.tag + "\n" +
            (actorInfo.number ? "│ ❌ Removido por: @" + actorInfo.number + "\n" : "") +
            "╰────────────────────◆";

          await sendSafe(conn, chatId, {
            text: texto,
            mentions
          });
        }

        return;
      }

      // ============================================================
      // ADD / REMOVE
      // ============================================================
      for (let i = 0; i < rawParticipants.length; i++) {
        const info = await normalizeParticipant(conn, rawParticipants[i], metaParts);
        if (!info.mentionJid) continue;

        const mentionJid = info.mentionJid;
        const number = info.number;
        const mention = info.tag;

        // ── ANTIARABE ──────────────────────────────────────────────
        if (action === "add" && antiArabe == 1 && number && info.phoneNumber) {
          const isArabic = arabes.some(function (cc) {
            return number.startsWith(cc);
          });

          if (isArabic) {
            const isAdminP = info.isAdminFinal;
            const isOwnerP = typeof global.isOwner === "function" && (
              global.isOwner(number) ||
              global.isOwner(mentionJid) ||
              global.isOwner(info.phoneNumber) ||
              global.isOwner(info.lid)
            );

            if (!isAdminP && !isOwnerP) {
              await sendSafe(conn, chatId, {
                text: "🚫 " + mention + " tiene un prefijo prohibido y será eliminado.",
                mentions: [mentionJid]
              });

              try {
                await conn.groupParticipantsUpdate(chatId, [info.groupJid], "remove");
              } catch (e) {
                console.error("[welcome] No se pudo eliminar antiarabe:", e);
              }

              continue;
            }
          }
        }

        // ── BIENVENIDA ─────────────────────────────────────────────
        if (action === "add") {
          if (welcomeActive != 1) continue;

          const perfilURL = await safeProfilePicture(conn, mentionJid, chatId);

          if (bienvenidaPersonalizada) {
            await sendSafe(conn, chatId, {
              image: { url: perfilURL },
              caption: "👋 " + mention + "\n\n" + bienvenidaPersonalizada,
              mentions: [mentionJid]
            });

            continue;
          }

          const msgBien = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
          const modo = Math.random() < 0.5 ? "video" : "imagen";

          if (modo === "video") {
            await sendSafe(conn, chatId, {
              video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
              caption: "👋 " + mention + "\n\n" + msgBien,
              mentions: [mentionJid]
            });

            continue;
          }

          try {
            const avatar = await loadImage(perfilURL);
            const fondo = await loadImage("https://cdn.russellxz.click/e72cc417.jpeg");

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

            await sendSafe(conn, chatId, {
              image: canvas.toBuffer(),
              caption: "👋 " + mention + "\n\n" + msgBien,
              mentions: [mentionJid]
            });
          } catch (canvasErr) {
            await sendSafe(conn, chatId, {
              image: { url: perfilURL },
              caption: "👋 " + mention + "\n\n" + msgBien,
              mentions: [mentionJid]
            });
          }

          continue;
        }

        // ── DESPEDIDA ──────────────────────────────────────────────
        if (action === "remove") {
          if (byeActive != 1) continue;

          const perfilURL2 = await safeProfilePicture(conn, mentionJid, chatId);

          if (despedidaPersonalizada) {
            await sendSafe(conn, chatId, {
              image: { url: perfilURL2 },
              caption: "👋 " + mention + "\n\n" + despedidaPersonalizada,
              mentions: [mentionJid]
            });

            continue;
          }

          const msgBye = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
          const modo2 = Math.random() < 0.5 ? "video" : "imagen";

          if (modo2 === "video") {
            await sendSafe(conn, chatId, {
              video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
              caption: "👋 " + mention + "\n\n" + msgBye,
              mentions: [mentionJid]
            });

            continue;
          }

          try {
            const avatar2 = await loadImage(perfilURL2);
            const fondo2 = await loadImage("https://cdn.russellxz.click/86913470.jpeg");

            const canvas2 = createCanvas(1080, 720);
            const ctx2 = canvas2.getContext("2d");

            ctx2.drawImage(fondo2, 0, 0, canvas2.width, canvas2.height);

            ctx2.save();
            ctx2.beginPath();
            ctx2.arc(150, 150, 85, 0, Math.PI * 2);
            ctx2.closePath();
            ctx2.clip();
            ctx2.globalAlpha = 0.85;
            ctx2.drawImage(avatar2, 65, 65, 170, 170);
            ctx2.restore();

            ctx2.globalAlpha = 1.0;

            await sendSafe(conn, chatId, {
              image: canvas2.toBuffer(),
              caption: "👋 " + mention + "\n\n" + msgBye,
              mentions: [mentionJid]
            });
          } catch (canvasErr2) {
            await sendSafe(conn, chatId, {
              image: { url: perfilURL2 },
              caption: "👋 " + mention + "\n\n" + msgBye,
              mentions: [mentionJid]
            });
          }
        }
      }
    } catch (err) {
      console.error("❌ Error en lógica de grupo:", err);
    }
  });
};

handler.run = handler;
module.exports = handler;
