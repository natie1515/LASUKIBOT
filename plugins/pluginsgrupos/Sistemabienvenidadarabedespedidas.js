const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

const DEBUG_WELCOME = true;

function log() {
  if (!DEBUG_WELCOME) return;
  console.log("[WELCOME-DEBUG]", ...arguments);
}

function warn() {
  console.warn("[WELCOME-WARN]", ...arguments);
}

function error() {
  console.error("[WELCOME-ERROR]", ...arguments);
}

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

function safeJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    try {
      return String(obj);
    } catch {
      return "[NO_JSON]";
    }
  }
}

function fixJid(jid) {
  if (!jid) return "";
  jid = String(jid);

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
  log("Normalizando participante RAW:", safeJson(raw));

  if (typeof raw === "string") {
    if (raw === "[object Object]") {
      warn("Participante llegó como string '[object Object]', eso no sirve:", raw);
      return {
        id: "",
        phoneNumber: "",
        lid: "",
        raw
      };
    }

    if (raw.trim().startsWith("{")) {
      try {
        const obj = JSON.parse(raw);
        return normalizeRawParticipant(obj);
      } catch (e) {
        warn("No se pudo parsear participante JSON string:", e.message || e);
      }
    }

    return {
      id: fixJid(raw),
      phoneNumber: isUserJid(raw) ? fixJid(raw) : "",
      lid: isLidJid(raw) ? fixJid(raw) : "",
      raw
    };
  }

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

    const result = {
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

    log("Participante normalizado básico:", safeJson(result));
    return result;
  }

  warn("Participante inválido o vacío:", raw);

  return {
    id: "",
    phoneNumber: "",
    lid: "",
    raw
  };
}

function findInMeta(info, metaParticipants) {
  if (!Array.isArray(metaParticipants)) return null;

  const found = metaParticipants.find(function (p) {
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

  log("Resultado búsqueda en metadata:", found ? safeJson(found) : "NO ENCONTRADO");
  return found;
}

async function getPnFromLid(conn, lid) {
  log("Intentando resolver LID:", lid);

  if (!lid || !isLidJid(lid)) return "";

  try {
    if (
      conn &&
      conn.signalRepository &&
      conn.signalRepository.lidMapping &&
      typeof conn.signalRepository.lidMapping.getPNForLID === "function"
    ) {
      const pn = await conn.signalRepository.lidMapping.getPNForLID(lid);
      log("Resultado getPNForLID:", pn);

      if (pn && isUserJid(pn)) return fixJid(pn);
    } else {
      log("conn.signalRepository.lidMapping.getPNForLID no existe en este conn");
    }
  } catch (e) {
    warn("Error resolviendo LID desde signalRepository:", e.message || e);
  }

  if (global.lidMap instanceof Map) {
    const pn = global.lidMap.get(lid);
    log("Resultado global.lidMap:", pn);

    if (pn && isUserJid(pn)) return fixJid(pn);
  } else {
    log("global.lidMap no existe o no es Map");
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

  if (!info.phoneNumber && info.lid) {
    const pn = await getPnFromLid(conn, info.lid);
    if (pn) info.phoneNumber = pn;
  }

  if (!info.lid && info.id && isLidJid(info.id)) info.lid = info.id;
  if (!info.phoneNumber && info.id && isUserJid(info.id)) info.phoneNumber = info.id;

  info.mentionJid = info.phoneNumber || info.id || info.lid;
  info.groupJid = info.id || info.lid || info.phoneNumber || info.mentionJid;
  info.number = jidNumber(info.phoneNumber || info.mentionJid || info.groupJid);
  info.tag = info.number ? "@" + info.number : "@usuario";

  info.isAdminFinal =
    info.admin === "admin" ||
    info.admin === "superadmin" ||
    info.isAdmin === true ||
    info.isSuperAdmin === true;

  log("Participante FINAL:", safeJson({
    id: info.id,
    phoneNumber: info.phoneNumber,
    lid: info.lid,
    mentionJid: info.mentionJid,
    groupJid: info.groupJid,
    number: info.number,
    tag: info.tag,
    admin: info.admin,
    isAdminFinal: info.isAdminFinal
  }));

  return info;
}

async function normalizeActor(conn, update, metaParticipants) {
  log("Normalizando actor:", safeJson({
    author: update.author,
    authorPn: update.authorPn,
    authorUsername: update.authorUsername
  }));

  const actorInfo = await normalizeParticipant(conn, {
    id: update.author || "",
    phoneNumber: update.authorPn || "",
    username: update.authorUsername || ""
  }, metaParticipants);

  return actorInfo;
}

async function safeProfilePicture(conn, jid, chatId) {
  log("Buscando foto de perfil:", jid);

  try {
    if (jid) {
      const url = await conn.profilePictureUrl(jid, "image");
      log("Foto encontrada del usuario:", url);
      return url;
    }
  } catch (e) {
    warn("No se pudo obtener foto del usuario:", jid, e.message || e);
  }

  try {
    const url = await conn.profilePictureUrl(chatId, "image");
    log("Usando foto del grupo:", url);
    return url;
  } catch (e) {
    warn("No se pudo obtener foto del grupo:", e.message || e);
  }

  log("Usando imagen fallback");
  return "https://cdn.russellxz.click/e72cc417.jpeg";
}

async function sendSafe(conn, chatId, content, label) {
  try {
    log("Intentando enviar mensaje:", label || "sin-label", safeJson({
      chatId,
      keys: Object.keys(content || {}),
      mentions: content && content.mentions ? content.mentions : []
    }));

    const res = await conn.sendMessage(chatId, content);

    log("Mensaje enviado OK:", label || "sin-label", safeJson({
      key: res && res.key ? res.key : null
    }));

    return res;
  } catch (e) {
    error("Error enviando mensaje:", label || "sin-label", e);
    return null;
  }
}

// ============================================================
// FALLBACK BAILEYS NUEVO:
// Maneja mensajes stub desde messages.upsert dentro de este plugin.
// No usa require("@whiskeysockets/baileys").
// ============================================================

const GROUP_STUB_ACTIONS = {
  28: "add",
  29: "remove",
  30: "promote",
  31: "demote",
  32: "add",
  33: "remove",
  71: "add"
};

function getActionFromStubType(stubType) {
  const n = Number(stubType);
  if (GROUP_STUB_ACTIONS[n]) return GROUP_STUB_ACTIONS[n];

  const s = String(stubType || "").toUpperCase();

  if (s.includes("GROUP_PARTICIPANT_ADD_REQUEST_JOIN")) return "add";
  if (s.includes("GROUP_PARTICIPANT_ADD")) return "add";
  if (s.includes("GROUP_PARTICIPANT_INVITE")) return "add";
  if (s.includes("GROUP_PARTICIPANT_REMOVE")) return "remove";
  if (s.includes("GROUP_PARTICIPANT_LEAVE")) return "remove";
  if (s.includes("GROUP_PARTICIPANT_PROMOTE")) return "promote";
  if (s.includes("GROUP_PARTICIPANT_DEMOTE")) return "demote";

  return null;
}

function parseStubParticipant(param) {
  if (!param) return null;

  if (typeof param === "object") return param;

  const text = String(param || "").trim();

  if (!text || text === "[object Object]") {
    warn("[STUB] Parámetro corrupto o inútil:", text);
    return null;
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch (e) {
      warn("[STUB] No se pudo parsear JSON:", text, e.message || e);
    }
  }

  return text;
}

function participantKeyForFingerprint(p) {
  if (!p) return "";

  let parsed = p;

  if (typeof p === "string") {
    const t = p.trim();

    if (t === "[object Object]") return "";

    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        parsed = JSON.parse(t);
      } catch (e) {
        return fixJid(t);
      }
    } else {
      return fixJid(t);
    }
  }

  if (parsed && typeof parsed === "object") {
    return fixJid(
      parsed.phoneNumber ||
      parsed.pn ||
      parsed.jid ||
      parsed.id ||
      parsed.lid ||
      parsed.participant ||
      ""
    );
  }

  return fixJid(String(parsed || ""));
}

function fingerprintGroupUpdate(update) {
  try {
    const chatId = update && update.id ? update.id : "";
    const action = update && update.action ? update.action : "";
    const participants = Array.isArray(update && update.participants)
      ? update.participants
      : [];

    const keys = participants
      .map(participantKeyForFingerprint)
      .filter(Boolean)
      .sort()
      .join(",");

    if (!chatId || !action || !keys) return "";

    return chatId + "|" + action + "|" + keys;
  } catch (e) {
    return "";
  }
}

function isBrokenObjectStringParticipants(update) {
  const participants = Array.isArray(update && update.participants)
    ? update.participants
    : [];

  if (!participants.length) return false;

  return participants.every(function (p) {
    return String(p) === "[object Object]";
  });
}

function markAndCheckDuplicateGroupUpdate(conn, update) {
  if (!conn.__sukiProcessedGroupUpdates) {
    conn.__sukiProcessedGroupUpdates = new Set();
  }

  const fp = fingerprintGroupUpdate(update);

  if (!fp) return false;

  if (conn.__sukiProcessedGroupUpdates.has(fp)) {
    warn("[DEDUP] Evento duplicado ignorado:", fp);
    return true;
  }

  conn.__sukiProcessedGroupUpdates.add(fp);

  setTimeout(function () {
    try {
      conn.__sukiProcessedGroupUpdates.delete(fp);
    } catch (e) {}
  }, 20000);

  return false;
}

function registerMessageStubFallback(conn) {
  if (conn.__sukiMessageStubFallback) {
    log("[STUB] messages.upsert fallback ya estaba registrado");
    return;
  }

  conn.__sukiMessageStubFallback = true;

  log("[STUB] Registrando fallback messages.upsert para eventos de grupo");

  conn.ev.on("messages.upsert", async function (ev) {
    try {
      const messages = Array.isArray(ev && ev.messages) ? ev.messages : [];

      for (const m of messages) {
        if (!m || !m.key) continue;

        const chatId = m.key.remoteJid;
        const stubType = m.messageStubType;

        if (!isGroupJid(chatId)) continue;
        if (!stubType) continue;

        const action = getActionFromStubType(stubType);

        log("[STUB] Mensaje stub detectado:", safeJson({
          type: ev.type,
          chatId,
          stubType,
          action,
          params: m.messageStubParameters,
          participant: m.key.participant,
          participantAlt: m.key.participantAlt,
          participantUsername: m.key.participantUsername,
          messageId: m.key.id
        }));

        if (!action) {
          warn("[STUB] StubType no mapeado para welcome:", stubType);
          continue;
        }

        const participants = (m.messageStubParameters || [])
          .map(parseStubParticipant)
          .filter(Boolean);

        if (!participants.length) {
          warn("[STUB] No pude sacar participantes del stub:", safeJson({
            chatId,
            stubType,
            params: m.messageStubParameters
          }));
          continue;
        }

        const syntheticUpdate = {
          id: chatId,
          author: m.key.participant || m.participant || "",
          authorPn: m.key.participantAlt || "",
          authorUsername: m.key.participantUsername || "",
          participants,
          action,
          __fromMessagesUpsert: true
        };

        log("[STUB] Update sintético creado:", safeJson(syntheticUpdate));

        setTimeout(function () {
          try {
            log("[STUB] Emitiendo group-participants.update manual:", safeJson(syntheticUpdate));
            conn.ev.emit("group-participants.update", syntheticUpdate);
          } catch (e) {
            error("[STUB] Error emitiendo update manual:", e);
          }
        }, 900);
      }
    } catch (e) {
      error("[STUB] Error en messages.upsert fallback:", e);
    }
  });
}

log("Archivo welcome.js cargado correctamente");

var handler = async function (conn) {
  log("handler welcome ejecutado. Conn existe:", !!conn);

  if (!conn) {
    error("No llegó conn al handler");
    return;
  }

  if (!conn.ev || typeof conn.ev.on !== "function") {
    error("conn.ev.on no existe. Este handler no puede escuchar eventos.");
    return;
  }

  registerMessageStubFallback(conn);

  if (!conn.__sukiLidMappingListener) {
    conn.__sukiLidMappingListener = true;

    log("Registrando listener lid-mapping.update");

    conn.ev.on("lid-mapping.update", function (data) {
      try {
        log("EVENTO lid-mapping.update recibido:", safeJson(data));

        if (!global.lidMap) global.lidMap = new Map();

        const lid = fixJid(data && (data.lid || data.id || ""));
        const pn = fixJid(data && (data.pn || data.phoneNumber || ""));

        if (lid && pn && isLidJid(lid) && isUserJid(pn)) {
          global.lidMap.set(lid, pn);
          log("LID guardado en global.lidMap:", lid, "=>", pn);
        }
      } catch (e) {
        warn("Error en lid-mapping.update:", e.message || e);
      }
    });
  } else {
    log("Listener lid-mapping.update ya estaba registrado");
  }

  if (conn.__sukiWelcomeListener) {
    warn("Listener group-participants.update ya estaba registrado. No se registra doble.");
    return;
  }

  conn.__sukiWelcomeListener = true;

  log("Registrando listener group-participants.update");

  conn.ev.on("group-participants.update", async function (update) {
    log("==============================================");
    log("EVENTO group-participants.update RECIBIDO");
    log("UPDATE COMPLETO:", safeJson(update));
    log("VIENE DESDE FALLBACK messages.upsert:", !!update.__fromMessagesUpsert);

    if (isBrokenObjectStringParticipants(update)) {
      warn("Evento group-participants.update vino corrupto con [object Object]. Se ignora para que trabaje el fallback messages.upsert.");
      return;
    }

    if (markAndCheckDuplicateGroupUpdate(conn, update)) {
      return;
    }

    try {
      const chatId = update.id;
      log("chatId:", chatId);

      if (!isGroupJid(chatId)) {
        warn("Evento ignorado porque no es grupo:", chatId);
        return;
      }

      const action = update.action;
      const rawParticipants = Array.isArray(update.participants) ? update.participants : [];

      log("action:", action);
      log("participants length:", rawParticipants.length);
      log("participants raw:", safeJson(rawParticipants));

      if (!rawParticipants.length) {
        warn("Evento sin participantes. No hago nada.");
        return;
      }

      let metadata;
      try {
        log("Solicitando metadata del grupo:", chatId);
        metadata = await conn.groupMetadata(chatId);
        log("Metadata obtenida:", safeJson({
          id: metadata && metadata.id,
          subject: metadata && metadata.subject,
          participantsCount: metadata && metadata.participants ? metadata.participants.length : 0
        }));
      } catch (e) {
        error("No se pudo obtener metadata:", e);
        return;
      }

      const metaParts = Array.isArray(metadata && metadata.participants)
        ? metadata.participants
        : [];

      log("metaParts length:", metaParts.length);
      log("Primeros metaParts:", safeJson(metaParts.slice(0, 5)));

      let welcomeActive;
      let byeActive;
      let antiArabe;

      try {
        welcomeActive = await getConfig(chatId, "welcome");
        byeActive = await getConfig(chatId, "despedidas");
        antiArabe = await getConfig(chatId, "antiarabe");

        log("CONFIG:", safeJson({
          welcome: welcomeActive,
          despedidas: byeActive,
          antiarabe: antiArabe,
          types: {
            welcome: typeof welcomeActive,
            despedidas: typeof byeActive,
            antiarabe: typeof antiArabe
          }
        }));
      } catch (e) {
        error("Error leyendo getConfig:", e);
        return;
      }

      const setwelcomePath = path.resolve("setwelcome.json");
      let personalizados = {};

      log("setwelcomePath:", setwelcomePath);
      log("Existe setwelcome.json:", fs.existsSync(setwelcomePath));

      if (fs.existsSync(setwelcomePath)) {
        try {
          const swData = JSON.parse(fs.readFileSync(setwelcomePath, "utf-8"));
          personalizados = swData[chatId] || {};
          log("Personalizados encontrados:", safeJson(personalizados));
        } catch (e) {
          warn("Error leyendo setwelcome.json:", e.message || e);
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

      log("Actor final:", safeJson({
        mentionJid: actorInfo.mentionJid,
        number: actorInfo.number,
        tag: actorInfo.tag
      }));

      // ============================================================
      // PROMOTE
      // ============================================================
      if (action === "promote") {
        log("Entrando en PROMOTE");

        for (let i = 0; i < rawParticipants.length; i++) {
          log("Procesando promote participante index:", i);

          const targetInfo = await normalizeParticipant(conn, rawParticipants[i], metaParts);

          if (!targetInfo.mentionJid) {
            warn("Promote sin mentionJid. Saltando participante:", safeJson(targetInfo));
            continue;
          }

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
          }, "PROMOTE");
        }

        log("Fin PROMOTE");
        return;
      }

      // ============================================================
      // DEMOTE
      // ============================================================
      if (action === "demote") {
        log("Entrando en DEMOTE");

        for (let i = 0; i < rawParticipants.length; i++) {
          log("Procesando demote participante index:", i);

          const targetInfo = await normalizeParticipant(conn, rawParticipants[i], metaParts);

          if (!targetInfo.mentionJid) {
            warn("Demote sin mentionJid. Saltando participante:", safeJson(targetInfo));
            continue;
          }

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
          }, "DEMOTE");
        }

        log("Fin DEMOTE");
        return;
      }

      // ============================================================
      // ADD / REMOVE
      // ============================================================
      log("Entrando en ADD/REMOVE. action:", action);

      for (let i = 0; i < rawParticipants.length; i++) {
        log("Procesando participante index:", i);

        const info = await normalizeParticipant(conn, rawParticipants[i], metaParts);

        if (!info.mentionJid) {
          warn("Participante sin mentionJid. Saltando:", safeJson(info));
          continue;
        }

        const mentionJid = info.mentionJid;
        const number = info.number;
        const mention = info.tag;

        log("Participante listo:", safeJson({
          action,
          mentionJid,
          number,
          mention,
          groupJid: info.groupJid,
          phoneNumber: info.phoneNumber,
          lid: info.lid
        }));

        // ── ANTIARABE ──────────────────────────────────────────────
        if (action === "add") {
          log("Check antiarabe:", safeJson({
            antiArabe,
            number,
            phoneNumber: info.phoneNumber
          }));
        }

        if (action === "add" && antiArabe == 1 && number && info.phoneNumber) {
          const isArabic = arabes.some(function (cc) {
            return number.startsWith(cc);
          });

          log("Resultado antiarabe:", safeJson({
            number,
            isArabic,
            isAdmin: info.isAdminFinal
          }));

          if (isArabic) {
            const isAdminP = info.isAdminFinal;
            const isOwnerP = typeof global.isOwner === "function" && (
              global.isOwner(number) ||
              global.isOwner(mentionJid) ||
              global.isOwner(info.phoneNumber) ||
              global.isOwner(info.lid)
            );

            log("Antiarabe owner/admin:", safeJson({
              isAdminP,
              isOwnerP
            }));

            if (!isAdminP && !isOwnerP) {
              await sendSafe(conn, chatId, {
                text: "🚫 " + mention + " tiene un prefijo prohibido y será eliminado.",
                mentions: [mentionJid]
              }, "ANTIARABE AVISO");

              try {
                log("Intentando eliminar antiarabe:", info.groupJid);
                await conn.groupParticipantsUpdate(chatId, [info.groupJid], "remove");
                log("Antiarabe eliminado OK");
              } catch (e) {
                error("No se pudo eliminar antiarabe:", e);
              }

              continue;
            }
          }
        }

        // ── BIENVENIDA ─────────────────────────────────────────────
        if (action === "add") {
          log("Entrando en ADD. welcomeActive:", welcomeActive);

          if (welcomeActive != 1) {
            warn("Bienvenida apagada por config. welcomeActive =", welcomeActive);
            continue;
          }

          const perfilURL = await safeProfilePicture(conn, mentionJid, chatId);

          if (bienvenidaPersonalizada) {
            log("Enviando bienvenida personalizada");

            await sendSafe(conn, chatId, {
              image: { url: perfilURL },
              caption: "👋 " + mention + "\n\n" + bienvenidaPersonalizada,
              mentions: [mentionJid]
            }, "BIENVENIDA PERSONALIZADA");

            continue;
          }

          const msgBien = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
          const modo = Math.random() < 0.5 ? "video" : "imagen";

          log("Bienvenida default:", safeJson({
            modo,
            msgBien,
            perfilURL
          }));

          if (modo === "video") {
            await sendSafe(conn, chatId, {
              video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
              caption: "👋 " + mention + "\n\n" + msgBien,
              mentions: [mentionJid]
            }, "BIENVENIDA VIDEO");

            continue;
          }

          try {
            log("Creando canvas bienvenida");

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
            }, "BIENVENIDA CANVAS");
          } catch (canvasErr) {
            error("Error canvas bienvenida, mando imagen directa:", canvasErr);

            await sendSafe(conn, chatId, {
              image: { url: perfilURL },
              caption: "👋 " + mention + "\n\n" + msgBien,
              mentions: [mentionJid]
            }, "BIENVENIDA FALLBACK");
          }

          continue;
        }

        // ── DESPEDIDA ──────────────────────────────────────────────
        if (action === "remove") {
          log("Entrando en REMOVE. byeActive:", byeActive);

          if (byeActive != 1) {
            warn("Despedida apagada por config. byeActive =", byeActive);
            continue;
          }

          const perfilURL2 = await safeProfilePicture(conn, mentionJid, chatId);

          if (despedidaPersonalizada) {
            log("Enviando despedida personalizada");

            await sendSafe(conn, chatId, {
              image: { url: perfilURL2 },
              caption: "👋 " + mention + "\n\n" + despedidaPersonalizada,
              mentions: [mentionJid]
            }, "DESPEDIDA PERSONALIZADA");

            continue;
          }

          const msgBye = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
          const modo2 = Math.random() < 0.5 ? "video" : "imagen";

          log("Despedida default:", safeJson({
            modo2,
            msgBye,
            perfilURL2
          }));

          if (modo2 === "video") {
            await sendSafe(conn, chatId, {
              video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
              caption: "👋 " + mention + "\n\n" + msgBye,
              mentions: [mentionJid]
            }, "DESPEDIDA VIDEO");

            continue;
          }

          try {
            log("Creando canvas despedida");

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
            }, "DESPEDIDA CANVAS");
          } catch (canvasErr2) {
            error("Error canvas despedida, mando imagen directa:", canvasErr2);

            await sendSafe(conn, chatId, {
              image: { url: perfilURL2 },
              caption: "👋 " + mention + "\n\n" + msgBye,
              mentions: [mentionJid]
            }, "DESPEDIDA FALLBACK");
          }

          continue;
        }

        warn("Action no reconocida para este handler:", action);
      }

      log("FIN EVENTO group-participants.update");
      log("==============================================");
    } catch (err) {
      error("Error general en lógica de grupo:", err);
    }
  });

  log("Listener group-participants.update registrado correctamente");
};

handler.run = handler;
module.exports = handler;
