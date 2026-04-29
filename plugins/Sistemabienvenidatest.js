"use strict";

/*
  LA SUKI BOT - Sistema SIEMPRE ACTIVO:
  ✅ Bienvenidas
  ✅ Despedidas
  ✅ Aviso cuando dan admin
  ✅ Aviso cuando quitan admin

  Archivo: plugins/Sistemabienvenidatest.js

  Esta versión escucha:
  1) group-participants.update
  2) fallback por messages.upsert cuando Baileys manda los cambios como messageStub

  No necesita comando ni configuración.
*/

const DEBUG = true;
const DEDUPE_TTL = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DIGITS = (s = "") => String(s || "").replace(/\D/g, "");

function log(...args) {
  if (DEBUG) console.log("[SUKI-WELCOME]", ...args);
}

function warn(...args) {
  console.warn("[SUKI-WELCOME-WARN]", ...args);
}

function error(...args) {
  console.error("[SUKI-WELCOME-ERROR]", ...args);
}

function isGroupJid(jid) {
  return typeof jid === "string" && jid.endsWith("@g.us");
}

function isPnJid(jid) {
  return typeof jid === "string" && jid.endsWith("@s.whatsapp.net");
}

function isLidJid(jid) {
  return typeof jid === "string" && jid.endsWith("@lid");
}

function fixJid(jid) {
  if (!jid) return "";

  jid = String(jid || "").trim();
  if (!jid) return "";

  if (jid.includes("@")) {
    const [left, domain] = jid.split("@");
    return `${String(left || "").split(":")[0]}@${domain}`;
  }

  return jid;
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

function safeParseMaybeJson(value) {
  if (typeof value !== "string") return value;

  const t = value.trim();
  if (!t || t === "[object Object]") return t;

  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {}
  }

  return t;
}

function jidNumber(jid) {
  return DIGITS(String(fixJid(jid)).split("@")[0].split(":")[0]);
}

function pnFromNumber(num) {
  const n = DIGITS(num);
  return n ? `${n}@s.whatsapp.net` : "";
}

function bestJidFromObject(obj) {
  if (!obj || typeof obj !== "object") return "";

  const values = [
    obj.phoneNumber,
    obj.pn,
    obj.jid,
    obj.participantPn,
    obj.senderPn,
    obj.participantAlt,
    obj.senderAlt,
    obj.id,
    obj.participant,
    obj.lid,
    obj.participantLid,
    obj.senderLid,
  ].map(fixJid).filter(Boolean);

  const pn = values.find(isPnJid);
  if (pn) return pn;

  const lid = values.find(isLidJid);
  if (lid) return lid;

  const any = values.find((x) => x.includes("@"));
  if (any) return any;

  const n = values.map(DIGITS).find(Boolean);
  return n ? pnFromNumber(n) : "";
}

function normalizeJid(input) {
  if (!input) return "";

  input = safeParseMaybeJson(input);

  if (typeof input === "object") {
    return bestJidFromObject(input);
  }

  const jid = fixJid(input);
  if (!jid || jid === "[object Object]") return "";

  if (!jid.includes("@"). && DIGITS(jid)) return pnFromNumber(jid);

  return jid;
}

function normalizeJidSafe(input) {
  try {
    return normalizeJid(input);
  } catch {
    return "";
  }
}

function mentionTag(jid) {
  const n = jidNumber(jid);
  return n ? `@${n}` : "@usuario";
}

function unique(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function sameUser(a, b) {
  const aj = normalizeJidSafe(a);
  const bj = normalizeJidSafe(b);

  if (!aj || !bj) return false;
  if (aj === bj) return true;

  const an = jidNumber(aj);
  const bn = jidNumber(bj);

  return !!an && !!bn && an === bn;
}

async function resolveRealJid(conn, input) {
  const raw = normalizeJidSafe(input);
  if (!raw) return "";

  if (isPnJid(raw) || isGroupJid(raw)) return raw;

  if (!isLidJid(raw)) return raw;

  try {
    if (typeof global.resolveRealJidAsync === "function") {
      const resolved = normalizeJidSafe(await global.resolveRealJidAsync(raw));
      if (isPnJid(resolved)) return resolved;
    }
  } catch {}

  try {
    if (global.lidMap instanceof Map) {
      const mapped = normalizeJidSafe(global.lidMap.get(raw));
      if (isPnJid(mapped)) return mapped;
    }
  } catch {}

  try {
    const pn = normalizeJidSafe(
      await conn.signalRepository?.lidMapping?.getPNForLID?.(raw)
    );

    if (isPnJid(pn)) {
      global.lidMap = global.lidMap || new Map();
      global.lidMap.set(raw, pn);
      global.lidMap.set(pn, raw);
      return pn;
    }
  } catch {}

  return raw;
}

function dedupe(key) {
  global._sukiWelcomeDedupe = global._sukiWelcomeDedupe || new Map();

  const now = Date.now();
  const map = global._sukiWelcomeDedupe;

  for (const [k, t] of map.entries()) {
    if (now - t > DEDUPE_TTL) map.delete(k);
  }

  if (map.has(key) && now - map.get(key) < DEDUPE_TTL) {
    return true;
  }

  map.set(key, now);
  return false;
}

async function getGroupInfo(conn, chatId) {
  try {
    const meta = await conn.groupMetadata(chatId);

    return {
      subject: meta?.subject || "este grupo",
      size: Array.isArray(meta?.participants) ? meta.participants.length : null,
      participants: Array.isArray(meta?.participants) ? meta.participants : [],
    };
  } catch (e) {
    warn("No pude leer metadata:", e.message || e);
    return {
      subject: "este grupo",
      size: null,
      participants: [],
    };
  }
}

async function getProfilePic(conn, jid, chatId) {
  const tries = unique([jid, chatId].map(normalizeJidSafe));

  for (const x of tries) {
    try {
      const pic = await conn.profilePictureUrl(x, "image");
      if (pic) return pic;
    } catch {}
  }

  return null;
}

async function sendEvent(conn, chatId, text, mentions = [], imageJid = "") {
  const cleanMentions = unique(mentions.map(normalizeJidSafe));

  if (imageJid) {
    const pic = await getProfilePic(conn, imageJid, chatId);

    if (pic) {
      try {
        await conn.sendMessage(chatId, {
          image: { url: pic },
          caption: text,
          mentions: cleanMentions,
        });
        return;
      } catch (e) {
        warn("Falló enviar con foto, mando texto:", e.message || e);
      }
    }
  }

  await conn.sendMessage(chatId, {
    text,
    mentions: cleanMentions,
  });
}

function getTargets(update) {
  if (Array.isArray(update?.participants)) {
    return update.participants.map(normalizeJidSafe).filter(Boolean);
  }

  const single = normalizeJidSafe(update?.participant || update?.target || update?.user);
  return single ? [single] : [];
}

function getActor(update) {
  return normalizeJidSafe(
    update?.author ||
    update?.actor ||
    update?.changedBy ||
    update?.by ||
    update?.sender ||
    ""
  );
}

function buildWelcomeText(target, group) {
  const count = group.size ? `\n│ 👥 Ahora somos *${group.size}* miembros.` : "";

  return `
╭─「 👑 LA SUKI BOT 👑 」
│
│ ✨ Bienvenid@ ${mentionTag(target)}
│ 🏠 Grupo: *${group.subject}*${count}
│
│ 💖 Pórtate bien, respeta las reglas
│ y disfruta el flow del grupo.
╰───────────────
`.trim();
}

function buildGoodbyeText(target, actor, group) {
  const kicked = actor && !sameUser(actor, target);
  const count = group.size ? `\n│ 👥 Ahora somos *${group.size}* miembros.` : "";
  const actorLine = kicked ? `\n│ 👤 Acción hecha por ${mentionTag(actor)}` : "";

  return `
╭─「 🚪 DESPEDIDA 」
│
│ ${kicked ? "❌" : "👋"} ${mentionTag(target)} ${kicked ? "fue sacad@ del grupo." : "salió del grupo."}
│ 🏠 Grupo: *${group.subject}*${count}${actorLine}
│
│ 🕊️ Que le vaya bonito.
╰───────────────
`.trim();
}

function buildPromoteText(target, actor, group) {
  const actorLine = actor && !sameUser(actor, target)
    ? `\n│ 👤 Admin que lo hizo: ${mentionTag(actor)}`
    : "";

  return `
╭─「 👑 NUEVO ADMIN 」
│
│ 🔥 ${mentionTag(target)} ahora es *admin*.
│ 🏠 Grupo: *${group.subject}*${actorLine}
│
│ Que use el poder con flow 😎
╰───────────────
`.trim();
}

function buildDemoteText(target, actor, group) {
  const actorLine = actor && !sameUser(actor, target)
    ? `\n│ 👤 Admin que lo hizo: ${mentionTag(actor)}`
    : "";

  return `
╭─「 🔻 ADMIN REMOVIDO 」
│
│ ⚠️ A ${mentionTag(target)} le quitaron el *admin*.
│ 🏠 Grupo: *${group.subject}*${actorLine}
│
│ Ya no tiene corona 👑
╰───────────────
`.trim();
}

const STUB_ACTION_BY_NUMBER = {
  28: "add",
  29: "remove",
  30: "promote",
  31: "demote",
  32: "add",
  33: "remove",
  71: "add",
};

function getActionFromStubType(stubType) {
  const num = Number(stubType);
  if (STUB_ACTION_BY_NUMBER[num]) return STUB_ACTION_BY_NUMBER[num];

  const s = String(stubType || "").toUpperCase();

  if (s.includes("GROUP_PARTICIPANT_ADD_REQUEST_JOIN")) return "add";
  if (s.includes("GROUP_PARTICIPANT_ADD")) return "add";
  if (s.includes("GROUP_PARTICIPANT_INVITE")) return "add";
  if (s.includes("GROUP_PARTICIPANT_JOIN")) return "add";
  if (s.includes("GROUP_PARTICIPANT_REMOVE")) return "remove";
  if (s.includes("GROUP_PARTICIPANT_LEAVE")) return "remove";
  if (s.includes("GROUP_PARTICIPANT_PROMOTE")) return "promote";
  if (s.includes("GROUP_PARTICIPANT_DEMOTE")) return "demote";

  return null;
}

function extractStubParticipants(m, action) {
  const params = Array.isArray(m?.messageStubParameters) ? m.messageStubParameters : [];

  const parsed = params
    .map(safeParseMaybeJson)
    .map(normalizeJidSafe)
    .filter(Boolean)
    .filter((jid) => !isGroupJid(jid));

  if (parsed.length) return unique(parsed);

  const fallback = normalizeJidSafe(
    m?.key?.participantPn ||
    m?.key?.participantAlt ||
    m?.key?.participant ||
    m?.participant ||
    ""
  );

  if (fallback && !isGroupJid(fallback)) return [fallback];

  return [];
}

function extractStubActor(m) {
  return normalizeJidSafe(
    m?.key?.participantPn ||
    m?.key?.participantAlt ||
    m?.key?.participant ||
    m?.participant ||
    m?.sender ||
    ""
  );
}

async function handleGroupUpdate(conn, update, source = "group-participants.update") {
  const chatId = normalizeJidSafe(update?.id || update?.jid || update?.groupId || update?.chatId);
  const action = String(update?.action || "").toLowerCase();

  log("Evento recibido:", safeStringify({ source, chatId, action, update }));

  if (!isGroupJid(chatId)) return;

  const validActions = ["add", "remove", "promote", "demote"];
  if (!validActions.includes(action)) {
    warn("Acción ignorada:", action);
    return;
  }

  const rawTargets = getTargets(update);
  if (!rawTargets.length) {
    warn("Evento sin targets:", safeStringify(update));
    return;
  }

  const group = await getGroupInfo(conn, chatId);
  const rawActor = getActor(update);
  const actor = rawActor ? await resolveRealJid(conn, rawActor) : "";

  for (const rawTarget of rawTargets) {
    const target = await resolveRealJid(conn, rawTarget);
    if (!target) continue;

    const key = `${chatId}:${action}:${jidNumber(target) || target}:${jidNumber(actor) || actor}`;

    if (dedupe(key)) {
      log("Duplicado ignorado:", key);
      continue;
    }

    let text = "";
    let imageJid = "";
    const mentions = [target];

    if (actor && !sameUser(actor, target)) mentions.push(actor);

    if (action === "add") {
      text = buildWelcomeText(target, group);
      imageJid = target;
    } else if (action === "remove") {
      text = buildGoodbyeText(target, actor, group);
      imageJid = target;
    } else if (action === "promote") {
      text = buildPromoteText(target, actor, group);
    } else if (action === "demote") {
      text = buildDemoteText(target, actor, group);
    }

    if (!text) continue;

    await sendEvent(conn, chatId, text, mentions, imageJid);
    await sleep(700);
  }
}

function registerLidMapping(conn) {
  if (conn.__sukiWelcomeLidMapping) return;
  conn.__sukiWelcomeLidMapping = true;

  conn.ev.on("lid-mapping.update", (data) => {
    try {
      global.lidMap = global.lidMap || new Map();

      const lid = normalizeJidSafe(data?.lid || data?.id || data?.participantLid || "");
      const pn = normalizeJidSafe(data?.pn || data?.phoneNumber || data?.jid || data?.participantPn || "");

      if (isLidJid(lid) && isPnJid(pn)) {
        global.lidMap.set(lid, pn);
        global.lidMap.set(pn, lid);
        log("LID guardado:", lid, "=>", pn);
      }
    } catch (e) {
      warn("Error lid-mapping.update:", e.message || e);
    }
  });
}

function registerStubFallback(conn) {
  if (conn.__sukiWelcomeStubFallback) return;
  conn.__sukiWelcomeStubFallback = true;

  conn.ev.on("messages.upsert", async (ev) => {
    try {
      const messages = Array.isArray(ev?.messages) ? ev.messages : [];

      for (const m of messages) {
        const chatId = normalizeJidSafe(m?.key?.remoteJid || "");
        if (!isGroupJid(chatId)) continue;

        const stubType = m?.messageStubType;
        if (!stubType) continue;

        const action = getActionFromStubType(stubType);
        if (!action) continue;

        const participants = extractStubParticipants(m, action);
        if (!participants.length) {
          warn("Stub sin participantes:", safeStringify({ stubType, params: m?.messageStubParameters }));
          continue;
        }

        const syntheticUpdate = {
          id: chatId,
          action,
          participants,
          author: extractStubActor(m),
          __source: "messages.upsert.stub",
          __messageStubType: stubType,
        };

        log("Fallback stub creado:", safeStringify(syntheticUpdate));

        setTimeout(() => {
          handleGroupUpdate(conn, syntheticUpdate, "messages.upsert.stub").catch((e) => {
            error("Error procesando fallback stub:", e);
          });
        }, 900);
      }
    } catch (e) {
      error("Error en messages.upsert fallback:", e);
    }
  });
}

module.exports = {
  name: "suki-welcome-goodbye-admin-events",

  async run(conn) {
    if (!conn || !conn.ev || typeof conn.ev.on !== "function") {
      error("No llegó conn.ev válido al sistema de bienvenida.");
      return;
    }

    registerLidMapping(conn);
    registerStubFallback(conn);

    if (!conn.__sukiWelcomeGroupParticipantsListener) {
      conn.__sukiWelcomeGroupParticipantsListener = true;

      conn.ev.on("group-participants.update", async (update) => {
        try {
          await handleGroupUpdate(conn, update, "group-participants.update");
        } catch (e) {
          error("Error en group-participants.update:", e);
        }
      });
    }

    console.log("✅ Sistema de bienvenidas/despedidas/admin conectado con fallback messages.upsert.");
  },
};
