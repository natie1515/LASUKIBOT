"use strict";

/*
  LA SUKI BOT - Sistema automático de:
  ✅ Bienvenidas
  ✅ Despedidas
  ✅ Aviso cuando dan admin
  ✅ Aviso cuando quitan admin

  Carpeta recomendada:
  plugins/eventos/bienvenidas.js

  No necesita comando.
  Siempre queda activo cuando inicia el bot.
*/

const DEBUG = false;
const DEDUPE_TTL = 12_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DIGITS = (s = "") => String(s || "").replace(/\D/g, "");

function log(...args) {
  if (DEBUG) console.log("[SUKI-WELCOME]", ...args);
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

function normalizeJid(input) {
  if (!input) return "";

  if (typeof input === "object") {
    input =
      input.jid ||
      input.id ||
      input.lid ||
      input.pn ||
      input.phoneNumber ||
      "";
  }

  let jid = String(input || "").trim();
  if (!jid) return "";

  if (jid.includes("@")) {
    const [left, domain] = jid.split("@");
    return `${left.split(":")[0]}@${domain}`;
  }

  return jid;
}

function jidNumber(jid) {
  return DIGITS(String(normalizeJid(jid)).split("@")[0]);
}

function mentionTag(jid) {
  const n = jidNumber(jid);
  return n ? `@${n}` : "@usuario";
}

function unique(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function sameUser(a, b) {
  const aj = normalizeJid(a);
  const bj = normalizeJid(b);

  if (!aj || !bj) return false;
  if (aj === bj) return true;

  const an = jidNumber(aj);
  const bn = jidNumber(bj);

  return !!an && !!bn && an === bn;
}

async function resolveRealJid(conn, jid) {
  const raw = normalizeJid(jid);
  if (!raw) return "";

  if (isPnJid(raw) || isGroupJid(raw)) return raw;

  if (!isLidJid(raw)) return raw;

  try {
    if (typeof global.resolveRealJidAsync === "function") {
      const resolved = normalizeJid(await global.resolveRealJidAsync(raw));
      if (isPnJid(resolved)) return resolved;
    }
  } catch {}

  try {
    if (global.lidMap instanceof Map) {
      const mapped =
        normalizeJid(global.lidMap.get(raw)) ||
        normalizeJid(global.lidMap.get(normalizeJid(raw)));

      if (isPnJid(mapped)) return mapped;
    }
  } catch {}

  try {
    const pn = normalizeJid(
      await conn.signalRepository?.lidMapping?.getPNForLID?.(raw)
    );

    if (isPnJid(pn)) {
      try {
        global.lidMap = global.lidMap || new Map();
        global.lidMap.set(raw, pn);
        global.lidMap.set(pn, raw);
      } catch {}

      return pn;
    }
  } catch {}

  return raw;
}

async function getGroupInfo(conn, chatId) {
  try {
    const meta = await conn.groupMetadata(chatId);

    return {
      subject: meta?.subject || "este grupo",
      size: Array.isArray(meta?.participants) ? meta.participants.length : null,
    };
  } catch {
    return {
      subject: "este grupo",
      size: null,
    };
  }
}

async function getProfilePic(conn, jid) {
  try {
    const pic = await conn.profilePictureUrl(jid, "image");
    return pic || null;
  } catch {
    return null;
  }
}

function dedupe(key) {
  global._sukiGroupEventDedupe = global._sukiGroupEventDedupe || new Map();

  const now = Date.now();
  const map = global._sukiGroupEventDedupe;

  for (const [k, t] of map.entries()) {
    if (now - t > DEDUPE_TTL) map.delete(k);
  }

  if (map.has(key) && now - map.get(key) < DEDUPE_TTL) {
    return true;
  }

  map.set(key, now);
  return false;
}

async function sendEvent(conn, chatId, text, mentions = [], imageJid = "") {
  const cleanMentions = unique(mentions.map(normalizeJid));

  if (imageJid) {
    const pic = await getProfilePic(conn, imageJid);

    if (pic) {
      try {
        await conn.sendMessage(chatId, {
          image: { url: pic },
          caption: text,
          mentions: cleanMentions,
        });
        return;
      } catch {}
    }
  }

  await conn.sendMessage(chatId, {
    text,
    mentions: cleanMentions,
  });
}

function getTargets(update) {
  if (Array.isArray(update?.participants)) {
    return update.participants.map(normalizeJid).filter(Boolean);
  }

  if (update?.participant) {
    return [normalizeJid(update.participant)].filter(Boolean);
  }

  return [];
}

function getActor(update) {
  return normalizeJid(
    update?.author ||
    update?.actor ||
    update?.changedBy ||
    update?.by ||
    ""
  );
}

function buildWelcomeText(target, group) {
  const count = group.size
    ? `\n│ 👥 Ahora somos *${group.size}* miembros.`
    : "";

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

  const count = group.size
    ? `\n│ 👥 Ahora somos *${group.size}* miembros.`
    : "";

  const actorLine = kicked
    ? `\n│ 👤 Acción hecha por ${mentionTag(actor)}`
    : "";

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

module.exports = {
  name: "suki-welcome-goodbye-admin-events",

  async run(conn) {
    if (!conn || !conn.ev) return;

    if (conn._sukiWelcomeGoodbyeAdminEvents) {
      log("Listener ya estaba conectado.");
      return;
    }

    conn._sukiWelcomeGoodbyeAdminEvents = true;

    conn.ev.on("group-participants.update", async (update) => {
      try {
        const chatId = normalizeJid(update?.id || update?.jid || update?.groupId);
        const action = String(update?.action || "").toLowerCase();

        if (!isGroupJid(chatId)) return;

        const validActions = ["add", "remove", "promote", "demote"];
        if (!validActions.includes(action)) return;

        const rawTargets = getTargets(update);
        if (!rawTargets.length) return;

        const group = await getGroupInfo(conn, chatId);
        const rawActor = getActor(update);
        const actor = rawActor ? await resolveRealJid(conn, rawActor) : "";

        for (const rawTarget of rawTargets) {
          const target = await resolveRealJid(conn, rawTarget);

          if (!target) continue;

          const key = `${chatId}:${action}:${normalizeJid(rawTarget)}:${normalizeJid(rawActor)}`;

          if (dedupe(key)) {
            log("Evento duplicado ignorado:", key);
            continue;
          }

          let text = "";
          let imageJid = "";
          let mentions = [target];

          if (actor && !sameUser(actor, target)) {
            mentions.push(actor);
          }

          if (action === "add") {
            text = buildWelcomeText(target, group);
            imageJid = target;
          }

          if (action === "remove") {
            text = buildGoodbyeText(target, actor, group);
            imageJid = target;
          }

          if (action === "promote") {
            text = buildPromoteText(target, actor, group);
          }

          if (action === "demote") {
            text = buildDemoteText(target, actor, group);
          }

          if (!text) continue;

          await sendEvent(conn, chatId, text, mentions, imageJid);

          await sleep(700);
        }
      } catch (e) {
        console.error("❌ Error en sistema bienvenida/despedida/admin:", e);
      }
    });

    console.log("✅ Sistema de bienvenidas/despedidas/admin conectado.");
  },
};
