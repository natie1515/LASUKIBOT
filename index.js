"use strict";

let canalId = ["120363266665814365@newsletter"];
let canalNombre = ["👑 LA SUKI BOT 👑"];

function setupConnection(conn) {
  conn.sendMessage2 = async (chat, content, m, options = {}) => {
    const firstChannel = {
      id: canalId[0],
      nombre: canalNombre[0]
    };

    if (content.sticker) {
      return conn.sendMessage(chat, {
        sticker: content.sticker
      }, {
        quoted: m,
        ...options
      });
    }

    const messageOptions = {
      ...content,
      mentions: content.mentions || options.mentions || [],
      contextInfo: {
        ...(content.contextInfo || {}),
        forwardedNewsletterMessageInfo: {
          newsletterJid: firstChannel.id,
          serverMessageId: "",
          newsletterName: firstChannel.nombre
        },
        forwardingScore: 9999999,
        isForwarded: true,
        mentionedJid: content.mentions || options.mentions || []
      }
    };

    return conn.sendMessage(chat, messageOptions, {
      quoted: m,
      ephemeralExpiration: 86400000,
      disappearingMessagesInChat: 86400000,
      ...options
    });
  };
}

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const figlet = require("figlet");
const readline = require("readline");
const pino = require("pino");
const { createCanvas, loadImage } = require("canvas");
const { setConfig, getConfig } = require("./db");

global.requireFromRoot = (mod) => require(path.join(__dirname, mod));

/* =========================================================
   HELPERS GLOBALES
========================================================= */

const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");
const JID_NUM = (jid = "") => DIGITS(String(jid || "").split("@")[0].split(":")[0]);
const isUserJid = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
const isLidJid = (j) => typeof j === "string" && j.endsWith("@lid");

function readJSON(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data || {}, null, 2));
}

function addZero(n) {
  const clean = DIGITS(n);
  if (!clean) return "";
  return clean.endsWith("0") ? clean : clean + "0";
}

function cleanUserJid(jid) {
  const n = JID_NUM(jid);
  return n ? `${n}@s.whatsapp.net` : null;
}

function cleanLidJid(jid) {
  const n = JID_NUM(jid);
  return n ? `${n}@lid` : null;
}

function cleanJid(jid = "") {
  const text = getJidText(jid).trim();

  if (!text) return "";

  if (text.includes(":") && text.includes("@s.whatsapp.net")) {
    const n = text.split(":")[0].replace(/[^0-9]/g, "");
    return n ? `${n}@s.whatsapp.net` : text;
  }

  return text;
}

function getJidText(value) {
  if (!value) return "";

  if (typeof value === "string") {
    if (value === "[object Object]") return "";

    const parsed = parseJsonObject(value);
    if (parsed) return getJidText(parsed);

    return value;
  }

  if (typeof value === "number") return String(value);

  if (typeof value === "object") {
    return String(
      value.jid ||
      value.phoneNumber ||
      value.pn ||
      value.id ||
      value.lid ||
      value.participant ||
      value.user ||
      value._serialized ||
      ""
    );
  }

  return "";
}

function parseJsonObject(value) {
  if (typeof value !== "string") return null;

  const clean = value.trim();
  if (!clean.startsWith("{") || !clean.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(clean);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

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

async function getConfigSafe(chatId, key, fallback = 0) {
  try {
    const value = getConfig(chatId, key);

    if (value && typeof value.then === "function") {
      const resolved = await value;
      return resolved ?? fallback;
    }

    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function getMessageText(m) {
  return (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    m.message?.documentMessage?.caption ||
    ""
  );
}

function getBotNumber(sock) {
  return DIGITS(String(sock.user?.id || sock.user?.jid || "").split(":")[0].split("@")[0]);
}

function getBotJid(sock) {
  const n = getBotNumber(sock);
  return n ? `${n}@s.whatsapp.net` : "";
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

  return Array.isArray(global.owner) && global.owner.some((entry) => {
    if (Array.isArray(entry)) {
      return entry.some((x) => DIGITS(x) === clean);
    }

    return DIGITS(entry) === clean;
  });
}

function safeIsOwner(value) {
  return isOwnerNumber(value);
}

function getParticipantCandidates(value) {
  const out = [];

  function add(v) {
    const text = cleanJid(v);
    if (text && text !== "[object Object]" && !out.includes(text)) out.push(text);
  }

  if (!value) return out;

  if (typeof value === "string") {
    const parsed = parseJsonObject(value);
    if (parsed) return getParticipantCandidates(parsed);

    add(value);
    return out;
  }

  if (typeof value === "number") {
    add(value);
    return out;
  }

  if (typeof value === "object") {
    add(value.jid);
    add(value.phoneNumber);
    add(value.pn);
    add(value.id);
    add(value.lid);
    add(value.participant);
    add(value.user);
    add(value._serialized);

    const n = DIGITS(value.phoneNumber || value.pn || value.user || "");
    if (n) add(`${n}@s.whatsapp.net`);
  }

  return out;
}

function makeRealJid(number = "") {
  const n = DIGITS(number);
  return n ? `${n}@s.whatsapp.net` : "";
}

/* =========================================================
   PREFIJOS
========================================================= */

let defaultPrefixes = [".", "#"];
const prefixPath = "./prefijos.json";

if (fs.existsSync(prefixPath)) {
  try {
    const contenido = fs.readFileSync(prefixPath, "utf-8").trim();
    const parsed = JSON.parse(contenido);

    if (Array.isArray(parsed)) {
      defaultPrefixes = parsed;
    } else if (typeof parsed === "string") {
      defaultPrefixes = [parsed];
    }
  } catch {}
}

global.prefixes = defaultPrefixes;

/* =========================================================
   OWNERS
========================================================= */

const ownerPath = "./owner.json";
if (!fs.existsSync(ownerPath)) {
  fs.writeFileSync(ownerPath, JSON.stringify([["15167096032"]], null, 2));
}

global.owner = JSON.parse(fs.readFileSync(ownerPath));

global.isOwner = function (jid) {
  return isOwnerNumber(jid);
};

/* =========================================================
   CARGAR PLUGINS
========================================================= */

global.plugins = [];

function loadPluginsRecursively(dir) {
  if (!fs.existsSync(dir)) return;

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      loadPluginsRecursively(fullPath);
      continue;
    }

    if (item.isFile() && item.name.endsWith(".js")) {
      try {
        delete require.cache[require.resolve(path.resolve(fullPath))];

        const plugin = require(path.resolve(fullPath));
        global.plugins.push(plugin);

        console.log(chalk.green(`✅ Plugin cargado: ${fullPath}`));
      } catch (err) {
        console.log(chalk.red(`❌ Error al cargar ${fullPath}: ${err}`));
      }
    }
  }
}

loadPluginsRecursively("./plugins");

/* =========================================================
   BANNER
========================================================= */

console.log(chalk.cyan(figlet.textSync("Suki 3.0 Bot", { font: "Standard" })));
console.log(chalk.green("\n✅ Iniciando conexión...\n"));
console.log(chalk.green("  [Hola] ") + chalk.white("🔑 Ingresar Tu Numero(Ej: 54911XXXXXX)\n"));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

let method = "1";
let phoneNumber = "";

/* =========================================================
   CACHE DE METADATA
========================================================= */

const groupMetaCache = new Map();
const GROUP_META_TTL = 15000;

async function getGroupMetadataCached(sock, chatId, force = false) {
  const now = Date.now();
  const old = groupMetaCache.get(chatId);

  if (!force && old && now - old.at < GROUP_META_TTL) {
    return old.data;
  }

  const data = await sock.groupMetadata(chatId);
  groupMetaCache.set(chatId, { at: now, data });

  try {
    updateLidMapFromMetadata(data);
  } catch {}

  return data;
}

function clearGroupMetadataCache(chatId) {
  groupMetaCache.delete(chatId);
}

/* =========================================================
   LID / PN NORMALIZACIÓN
========================================================= */

function updateLidMap(lid, pn) {
  if (!lid || !pn) return;
  if (!isLidJid(lid) || !isUserJid(pn)) return;

  global.lidMap = global.lidMap || new Map();
  global.lidMap.set(lid, pn);
  global.lidMap.set(pn, lid);
}

function updateLidMapFromMetadata(meta) {
  const parts = Array.isArray(meta?.participants) ? meta.participants : [];

  for (const p of parts) {
    const lid = [p?.id, p?.lid].find(isLidJid);
    const pn = [p?.jid, p?.phoneNumber, p?.pn, p?.id].find(isUserJid);

    if (lid && pn) updateLidMap(lid, cleanJid(pn));
  }
}

async function toRealJid(sock, jid) {
  if (!jid || typeof jid !== "string") return jid;
  if (isUserJid(jid)) return cleanJid(jid);
  if (!isLidJid(jid)) return jid;

  global.lidMap = global.lidMap || new Map();

  const cached = global.lidMap.get(jid);
  if (cached && isUserJid(cached)) return cleanJid(cached);

  try {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
    if (pn && isUserJid(pn)) {
      const cleanPn = cleanJid(pn);
      updateLidMap(jid, cleanPn);
      return cleanPn;
    }
  } catch {}

  return jid;
}

function toRealJidSync(jid) {
  if (!jid || typeof jid !== "string") return jid;
  if (isUserJid(jid)) return cleanJid(jid);

  global.lidMap = global.lidMap || new Map();

  if (isLidJid(jid) && global.lidMap.has(jid)) {
    return global.lidMap.get(jid);
  }

  return jid;
}

async function normalizeMessageIdentity(sock, m) {
  const isUser = isUserJid;
  const isLid = isLidJid;

  global.lidMap = global.lidMap || new Map();

  const altPn =
    (isUser(m.key?.senderPn) && m.key.senderPn) ||
    (isUser(m.key?.participantPn) && m.key.participantPn) ||
    (isUser(m.key?.senderAlt) && m.key.senderAlt) ||
    (isUser(m.key?.participantAlt) && m.key.participantAlt) ||
    null;

  const legacy =
    (isUser(m.key?.jid) && m.key.jid) ||
    (isUser(m.key?.participant) && m.key.participant) ||
    (
      m.key?.remoteJid &&
      !m.key.remoteJid.endsWith("@g.us") &&
      isUser(m.key.remoteJid) &&
      m.key.remoteJid
    ) ||
    null;

  let realJidOfSender = altPn || legacy;

  const lidOfSender =
    (isLid(m.key?.senderLid) && m.key.senderLid) ||
    (isLid(m.key?.participantLid) && m.key.participantLid) ||
    (isLid(m.key?.participant) && m.key.participant) ||
    (isLid(m.key?.remoteJid) && m.key.remoteJid) ||
    null;

  if (!realJidOfSender && lidOfSender) {
    const resolved = await toRealJid(sock, lidOfSender);
    if (resolved && isUser(resolved)) {
      realJidOfSender = resolved;
    }
  }

  if (realJidOfSender && lidOfSender) {
    updateLidMap(lidOfSender, cleanJid(realJidOfSender));
  }

  if (realJidOfSender) {
    realJidOfSender = cleanJid(realJidOfSender);
    m.key.jid = realJidOfSender;
    m.key.participant = realJidOfSender;
    m.realJid = realJidOfSender;
    m.realNumber = DIGITS(realJidOfSender);
    m.realLid = lidOfSender;
  } else if (lidOfSender) {
    m.realJid = lidOfSender;
    m.realNumber = DIGITS(lidOfSender);
    m.realLid = lidOfSender;
  } else {
    m.realJid = null;
    m.realNumber = null;
    m.realLid = null;
  }

  if (m.key?.remoteJid && isLid(m.key.remoteJid) && realJidOfSender) {
    m.key.remoteJid = realJidOfSender;
  }

  const ctx =
    m.message?.extendedTextMessage?.contextInfo ||
    m.message?.imageMessage?.contextInfo ||
    m.message?.videoMessage?.contextInfo ||
    m.message?.documentMessage?.contextInfo ||
    m.message?.audioMessage?.contextInfo ||
    m.message?.stickerMessage?.contextInfo ||
    null;

  if (ctx) {
    if (ctx.participant) ctx.participant = await toRealJid(sock, ctx.participant);
    if (ctx.participantPn && isUser(ctx.participantPn)) ctx.participant = cleanJid(ctx.participantPn);
    if (ctx.remoteJid && isLid(ctx.remoteJid)) ctx.remoteJid = await toRealJid(sock, ctx.remoteJid);

    if (Array.isArray(ctx.mentionedJid)) {
      ctx.mentionedJid = ctx.mentionedJid.map(toRealJidSync);
    }

    if (Array.isArray(ctx.groupMentions)) {
      ctx.groupMentions = ctx.groupMentions.map((g) => {
        if (g && g.groupJid) g.groupJid = toRealJidSync(g.groupJid);
        return g;
      });
    }
  }

  global.resolveRealJid = toRealJidSync;
  global.resolveRealJidAsync = (jid) => toRealJid(sock, jid);
  global.resolveRealNumber = (jid) => DIGITS(toRealJidSync(jid) || "");
}

async function getSenderIdentity(sock, m) {
  const chatId = m.key.remoteJid;
  const raw = String(m.key.participant || m.key.remoteJid || "");

  let realJid = null;
  let lidJid = null;

  const pnFields = [
    m.realJid,
    m.key?.senderPn,
    m.key?.participantPn,
    m.key?.senderAlt,
    m.key?.participantAlt,
    m.key?.participant,
    raw
  ].filter(Boolean);

  for (const jid of pnFields) {
    if (isUserJid(jid)) {
      realJid = cleanUserJid(jid);
      break;
    }
  }

  const lidFields = [
    m.realLid,
    m.realJid,
    m.key?.senderLid,
    m.key?.participantLid,
    m.key?.participant,
    raw
  ].filter(Boolean);

  for (const jid of lidFields) {
    if (isLidJid(jid)) {
      lidJid = cleanLidJid(jid);
      break;
    }
  }

  try {
    if (global.lidMap instanceof Map) {
      if (lidJid && !realJid) {
        const pn = global.lidMap.get(lidJid);
        if (isUserJid(pn)) realJid = cleanUserJid(pn);
      }

      if (realJid && !lidJid) {
        const lid = global.lidMap.get(realJid);
        if (isLidJid(lid)) lidJid = cleanLidJid(lid);
      }
    }
  } catch {}

  try {
    if (lidJid && !realJid) {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
      if (isUserJid(pn)) {
        realJid = cleanUserJid(pn);
        updateLidMap(lidJid, realJid);
      }
    }
  } catch {}

  try {
    if (realJid && !lidJid) {
      const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(realJid);
      if (isLidJid(lid)) {
        lidJid = cleanLidJid(lid);
        updateLidMap(lidJid, realJid);
      }
    }
  } catch {}

  const pnNumber = realJid ? JID_NUM(realJid) : "";
  const zeroNumber = pnNumber ? addZero(pnNumber) : "";
  const lidNumber = lidJid ? JID_NUM(lidJid) : "";
  const realNumber = m.realNumber ? DIGITS(m.realNumber) : "";
  const rawNumber = JID_NUM(raw);

  const numbers = new Set();

  if (pnNumber) numbers.add(pnNumber);
  if (zeroNumber && zeroNumber !== pnNumber) numbers.add(zeroNumber);
  if (lidNumber && lidNumber !== pnNumber && lidNumber !== zeroNumber) numbers.add(lidNumber);
  if (realNumber) numbers.add(realNumber);
  if (rawNumber) numbers.add(rawNumber);

  if (realNumber && (isUserJid(m.realJid) || isUserJid(raw))) {
    const rz = addZero(realNumber);
    if (rz && rz !== realNumber) numbers.add(rz);
  }

  return {
    chatId,
    raw,
    realJid,
    lidJid,
    pnNumber,
    lidNumber,
    realNumber,
    rawNumber,
    numbers,
    mentionJid: realJid || lidJid || raw,
    mentionNum: pnNumber || realNumber || lidNumber || rawNumber || "usuario"
  };
}

async function isAdminByIdentity(sock, chatId, identity) {
  try {
    const meta = await getGroupMetadataCached(sock, chatId);
    const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

    const adminNums = new Set();

    for (const p of rawParts) {
      const flagAdmin = p?.admin === "admin" || p?.admin === "superadmin";
      if (!flagAdmin) continue;

      const ids = [
        p?.id,
        p?.jid,
        p?.lid,
        p?.pn,
        p?.phoneNumber,
        p?.jidAlt
      ].filter(x => typeof x === "string");

      try {
        if (typeof sock.lidParser === "function") {
          const parsed = sock.lidParser([p]);
          if (parsed?.[0]?.id) ids.push(parsed[0].id);
          if (parsed?.[0]?.jid) ids.push(parsed[0].jid);
        }
      } catch {}

      for (const id of ids) {
        const d = JID_NUM(id);

        if (d) {
          adminNums.add(d);

          const dz = addZero(d);
          if (dz && dz !== d) adminNums.add(dz);
        }

        if (isLidJid(id)) {
          try {
            if (global.lidMap instanceof Map) {
              const mapped = global.lidMap.get(cleanLidJid(id));
              const md = JID_NUM(mapped);

              if (md) {
                adminNums.add(md);

                const md0 = addZero(md);
                if (md0 && md0 !== md) adminNums.add(md0);
              }
            }
          } catch {}

          try {
            const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(cleanLidJid(id));

            if (isUserJid(pn)) {
              const pd = JID_NUM(pn);

              if (pd) {
                adminNums.add(pd);

                const pd0 = addZero(pd);
                if (pd0 && pd0 !== pd) adminNums.add(pd0);
              }

              updateLidMap(cleanLidJid(id), cleanUserJid(pn));
            }
          } catch {}
        }
      }
    }

    return [...identity.numbers].some(n => adminNums.has(n));
  } catch {
    return false;
  }
}

async function deleteMessage(sock, m, chatId, identity) {
  const deleteKeys = [];

  deleteKeys.push(m.key);

  const possibleParticipants = [
    m.key?.participant,
    identity.raw,
    identity.lidJid,
    identity.realJid
  ].filter(Boolean);

  for (const participant of [...new Set(possibleParticipants)]) {
    deleteKeys.push({
      remoteJid: chatId,
      fromMe: false,
      id: m.key.id,
      participant
    });
  }

  for (const key of deleteKeys) {
    try {
      await sock.sendMessage(chatId, { delete: key });
      return true;
    } catch {}
  }

  return false;
}

async function removeUser(sock, chatId, identity) {
  const ids = [
    identity.raw,
    identity.realJid,
    identity.lidJid
  ].filter(Boolean);

  for (const jid of [...new Set(ids)]) {
    try {
      await sock.groupParticipantsUpdate(chatId, [jid], "remove");
      clearGroupMetadataCache(chatId);
      return true;
    } catch {}
  }

  return false;
}

/* =========================================================
   SISTEMA INTEGRADO DE BIENVENIDAS / DESPEDIDAS / PROMOTE / DEMOTE
========================================================= */

const adminCache = {};
const recentParticipantEvents = new Map();
const RECENT_PARTICIPANT_EVENT_TTL = 10000;

function parseStubParticipantParam(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const parsed = parseJsonObject(value);

    if (parsed) {
      return {
        id: cleanJid(parsed.id || ""),
        jid: cleanJid(parsed.jid || parsed.phoneNumber || parsed.pn || ""),
        phoneNumber: cleanJid(parsed.phoneNumber || parsed.jid || parsed.pn || ""),
        lid: cleanJid(parsed.lid || parsed.id || ""),
        admin: parsed.admin ?? null,
        raw: parsed
      };
    }

    return cleanJid(value);
  }

  if (typeof value === "object") {
    return {
      id: cleanJid(value.id || ""),
      jid: cleanJid(value.jid || value.phoneNumber || value.pn || ""),
      phoneNumber: cleanJid(value.phoneNumber || value.jid || value.pn || ""),
      lid: cleanJid(value.lid || value.id || ""),
      admin: value.admin ?? null,
      raw: value
    };
  }

  return cleanJid(value);
}

function stubActionToGroupAction(stubType, type = "") {
  const n = Number(stubType);
  const s = String(type || stubType || "").toLowerCase();

  if (n === 27 || s.includes("group_participant_add")) return "add";
  if (n === 28 || s.includes("group_participant_remove")) return "remove";
  if (n === 29 || s.includes("group_participant_promote")) return "promote";
  if (n === 30 || s.includes("group_participant_demote")) return "demote";

  return "";
}

function buildUpdateFromStubMessage(m = {}) {
  const chatId = cleanJid(m.key?.remoteJid || "");
  if (!chatId || !chatId.endsWith("@g.us")) return null;

  const action = stubActionToGroupAction(m.messageStubType, m.type);
  if (!action) return null;

  const params = Array.isArray(m.messageStubParameters)
    ? m.messageStubParameters
    : [];

  const participants = params
    .map(parseStubParticipantParam)
    .filter(Boolean)
    .filter(x => {
      if (typeof x === "string") {
        return x.endsWith("@s.whatsapp.net") || x.endsWith("@lid");
      }

      return (
        String(x.id || "").endsWith("@lid") ||
        String(x.lid || "").endsWith("@lid") ||
        String(x.jid || "").endsWith("@s.whatsapp.net") ||
        String(x.phoneNumber || "").endsWith("@s.whatsapp.net")
      );
    });

  if (!participants.length) return null;

  const author = cleanJid(
    m.key?.participant ||
    m.participant ||
    m.key?.participantPn ||
    m.key?.participantLid ||
    ""
  );

  return {
    id: chatId,
    action,
    participants,
    author,
    fromStub: true,
    stubType: m.messageStubType,
    stubRawType: m.type || ""
  };
}

function makeParticipantDedupKey(update = {}) {
  const chatId = cleanJid(update?.id || "");
  const action = String(update?.action || "").toLowerCase();

  const participants = Array.isArray(update?.participants)
    ? update.participants
    : [];

  const ids = participants.map(p => {
    const candidates = getParticipantCandidates(p);

    return (
      candidates.find(x => x.endsWith("@s.whatsapp.net")) ||
      candidates.find(x => x.endsWith("@lid")) ||
      cleanJid(getJidText(p)) ||
      JSON.stringify(p)
    );
  }).sort();

  return `${chatId}|${action}|${ids.join(",")}`;
}

function shouldSkipParticipantDuplicate(update = {}) {
  const key = makeParticipantDedupKey(update);
  const now = Date.now();

  for (const [k, t] of recentParticipantEvents.entries()) {
    if (now - t > RECENT_PARTICIPANT_EVENT_TTL) {
      recentParticipantEvents.delete(k);
    }
  }

  if (recentParticipantEvents.has(key)) return true;

  recentParticipantEvents.set(key, now);
  return false;
}

function resolveParticipantFromMeta(meta, anyJid) {
  const out = {
    realJid: null,
    lidJid: null,
    number: null
  };

  const raw = Array.isArray(meta?.participants) ? meta.participants : [];
  const candidates = getParticipantCandidates(anyJid);

  for (const c of candidates) {
    if (isUserJid(c)) {
      out.realJid = cleanJid(c);
      out.number = JID_NUM(c);
    }

    if (isLidJid(c)) {
      out.lidJid = c;
    }
  }

  try {
    if (global.lidMap instanceof Map) {
      for (const c of candidates) {
        const resolved = global.lidMap.get(c);

        if (resolved && isUserJid(resolved)) {
          out.realJid = cleanJid(resolved);
          out.number = JID_NUM(resolved);
        }
      }
    }
  } catch {}

  for (const p of raw) {
    const ids = getParticipantCandidates(p);
    const match = candidates.some(c => ids.includes(c));

    if (!match) continue;

    for (const id of ids) {
      if (isUserJid(id)) {
        out.realJid = cleanJid(id);
        out.number = JID_NUM(id);
      }

      if (isLidJid(id)) {
        out.lidJid = id;
      }
    }

    if (isUserJid(p?.jid)) {
      out.realJid = cleanJid(p.jid);
      out.number = JID_NUM(p.jid);
    }

    if (isUserJid(p?.phoneNumber)) {
      out.realJid = cleanJid(p.phoneNumber);
      out.number = JID_NUM(p.phoneNumber);
    }

    if (isUserJid(p?.pn)) {
      out.realJid = cleanJid(p.pn);
      out.number = JID_NUM(p.pn);
    }

    if (isLidJid(p?.id)) {
      out.lidJid = p.id;
    }

    if (out.lidJid && out.realJid) {
      updateLidMap(out.lidJid, out.realJid);
    }

    break;
  }

  if (!out.number) {
    for (const c of candidates) {
      const n = JID_NUM(c);

      if (n) {
        out.number = n;

        if (!out.realJid && isUserJid(c)) {
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

async function handleGroupParticipantsUpdate(sock, update) {
  try {
    const chatId = cleanJid(update?.id || "");
    const action = String(update?.action || "").toLowerCase();

    if (!chatId || !chatId.endsWith("@g.us")) return;

    const participants = Array.isArray(update?.participants)
      ? update.participants
      : [];

    if (!participants.length) return;

    if (!["add", "remove", "promote", "demote"].includes(action)) return;

    if (shouldSkipParticipantDuplicate(update)) {
      console.log("♻️ Evento duplicado ignorado:", action, chatId);
      return;
    }

    clearGroupMetadataCache(chatId);

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(update?.fromStub ? "🧩 EVENTO DE PARTICIPANTES POR STUB" : "👥 EVENTO DE PARTICIPANTES");
    console.log("➡️ Grupo:", chatId);
    console.log("➡️ Acción:", action);
    console.log("➡️ Participantes:", participants.length);

    if (update?.fromStub) {
      console.log("➡️ StubType:", update.stubType);
      console.log("➡️ Tipo:", update.stubRawType || "N/A");
    }

    const metadata = await getGroupMetadataCached(sock, chatId, true).catch((e) => {
      console.log("⚠️ No se pudo leer metadata del grupo:", e.message);
      return null;
    });

    if (!metadata) return;

    if (!adminCache[chatId]) {
      adminCache[chatId] = new Set(
        metadata.participants
          .filter(p => p.admin === "admin" || p.admin === "superadmin")
          .map(p => cleanJid(getJidText(p)))
          .filter(Boolean)
      );
    }

    const welcomeActive = await getConfigSafe(chatId, "welcome", 0);
    const byeActive = await getConfigSafe(chatId, "despedidas", 0);
    const antiArabe = await getConfigSafe(chatId, "antiarabe", 0);

    console.log("⚙️ Config welcome:", welcomeActive);
    console.log("⚙️ Config despedidas:", byeActive);
    console.log("⚙️ Config antiarabe:", antiArabe);

    const setwelcomePath = path.resolve("setwelcome.json");
    const setwelcomeData = readJSON(setwelcomePath, {});
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

    if (action === "promote" || action === "demote") {
      const actor = cleanJid(update?.author || update?.authorPn || "");
      const actorNum = actor ? DIGITS(actor) : "Desconocido";
      const actorMention = actor || null;

      for (const targetRaw of participants) {
        const target = cleanJid(getJidText(targetRaw));
        const resolved = resolveParticipantFromMeta(metadata, targetRaw);
        const targetMention = resolved.realJid || resolved.lidJid || target;
        const targetNum = resolved.number || JID_NUM(targetMention) || "Desconocido";

        if (!targetMention) continue;

        const mentions = [
          targetMention,
          actorMention
        ].filter(Boolean).map(String);

        if (action === "promote") {
          const texto =
`╭──『 👑 *NUEVO ADMIN* 』─◆
│ 👤 Usuario: @${targetNum}
│ ✅ Ascendido por: @${actorNum}
╰────────────────────◆`;

          await sock.sendMessage(chatId, {
            text: texto,
            mentions
          });

          console.log("✅ Aviso promote enviado:", targetMention);
        }

        if (action === "demote") {
          const texto =
`╭──『 📉 *ADMIN DEGRADADO* 』─◆
│ 👤 Usuario: @${targetNum}
│ ❌ Degradado por: @${actorNum}
╰────────────────────◆`;

          await sock.sendMessage(chatId, {
            text: texto,
            mentions
          });

          console.log("✅ Aviso demote enviado:", targetMention);
        }
      }

      return;
    }

    for (const pRaw of participants) {
      const participant = cleanJid(getJidText(pRaw));
      const resolved = resolveParticipantFromMeta(metadata, pRaw);

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
        JID_NUM(mentionId) ||
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
            await sock.sendMessage(chatId, {
              text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
              mentions: [mentionId]
            });

            try {
              await sock.groupParticipantsUpdate(chatId, [mentionId], "remove");
              clearGroupMetadataCache(chatId);
            } catch (e1) {
              try {
                if (participant && participant !== mentionId) {
                  await sock.groupParticipantsUpdate(chatId, [participant], "remove");
                  clearGroupMetadataCache(chatId);
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
          sock,
          resolved.realJid || mentionId,
          chatId,
          "https://cdn.russellxz.click/e72cc417.jpeg"
        );

        if (bienvenidaPersonalizada) {
          await sock.sendMessage(chatId, {
            image: { url: perfilURL },
            caption: `👋 ${mention}\n\n${bienvenidaPersonalizada}`,
            mentions: [mentionId]
          });
        } else {
          const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
          const modo = Math.random() < 0.5 ? "video" : "imagen";

          if (modo === "video") {
            await sock.sendMessage(chatId, {
              video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
              caption: `👋 ${mention}\n\n${mensaje}`,
              mentions: [mentionId]
            });
          } else {
            await sendWelcomeImage(
              sock,
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
          sock,
          resolved.realJid || mentionId,
          chatId,
          "https://cdn.russellxz.click/7177383b.jpg"
        );

        if (despedidaPersonalizada) {
          await sock.sendMessage(chatId, {
            image: { url: perfilURL },
            caption: `👋 ${mention}\n\n${despedidaPersonalizada}`,
            mentions: [mentionId]
          });
        } else {
          const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
          const modo = Math.random() < 0.5 ? "video" : "imagen";

          if (modo === "video") {
            await sock.sendMessage(chatId, {
              video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
              caption: `👋 ${mention}\n\n${mensaje}`,
              mentions: [mentionId]
            });
          } else {
            await sendByeImage(
              sock,
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

    const newMeta = await getGroupMetadataCached(sock, chatId, true).catch(() => null);

    if (newMeta) {
      adminCache[chatId] = new Set(
        newMeta.participants
          .filter(p => p.admin === "admin" || p.admin === "superadmin")
          .map(p => cleanJid(getJidText(p)))
          .filter(Boolean)
      );
    }

  } catch (err) {
    console.error("❌ Error en lógica de grupo:", err);
  }
}

function installWelcomeSystem(sock) {
  if (sock.__sukiWelcomeIndexEventsInstalled) return;

  sock.__sukiWelcomeIndexEventsInstalled = true;

  // Bloquea el listener viejo del plugin para evitar duplicados.
  sock.__sukiWelcomeOldListenerStarted = true;

  sock.ev.on("group-participants.update", async (update) => {
    await handleGroupParticipantsUpdate(sock, update);
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const m of messages || []) {
        const fakeUpdate = buildUpdateFromStubMessage(m);
        if (!fakeUpdate) continue;

        await handleGroupParticipantsUpdate(sock, fakeUpdate);
      }
    } catch (e) {
      console.log("❌ Error en fallback messages.upsert participantes:", e.message);
    }
  });

  console.log("✅ Sistema integrado de bienvenida/despedida activado.");
  console.log("✅ Fallback messageStubType 27/28/29/30 activado.");
}

/* =========================================================
   BOT
========================================================= */

(async () => {
  const mod = await import("@whiskeysockets/baileys");
  const B = mod.default && Object.keys(mod).length === 1 ? mod.default : mod;

  const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestWaWebVersion,
    fetchLatestBaileysVersion,
    downloadContentFromMessage
  } = B;

  const getWaVersion = typeof fetchLatestWaWebVersion === "function"
    ? fetchLatestWaWebVersion
    : fetchLatestBaileysVersion;

  const { state, saveCreds } = await useMultiFileAuthState("./sessions");

  if (!fs.existsSync("./sessions/creds.json")) {
    method = await question(chalk.magenta("📞(VAMOS AYA😎): "));
    phoneNumber = method.replace(/\D/g, "");

    if (!phoneNumber) {
      console.log(chalk.red("\n❌ Número inválido."));
      process.exit(1);
    }

    method = "2";
  }

  async function startBot() {
    try {
      const { version } = await getWaVersion();

      const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        browser: method === "1"
          ? ["AzuraBot", "Safari", "1.0.0"]
          : ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: method === "1",
        markOnlineOnConnect: false,
        syncFullHistory: false,
        fireInitQueries: false,
        generateHighQualityLinkPreview: false
      });

      global.wa = { downloadContentFromMessage };
      sock.wa = global.wa;

      setupConnection(sock);

      try {
        const { startWebServer } = require("./webserver");
        startWebServer(sock);
      } catch (e) {
        console.error("❌ Error iniciando API web:", e);
      }

      sock.lidParser = function (participants = []) {
        try {
          return participants.map(v => ({
            ...v,
            id: (
              typeof v?.id === "string" &&
              v.id.endsWith("@lid") &&
              (v.jid || v.phoneNumber || v.pn)
            )
              ? cleanJid(v.jid || v.phoneNumber || v.pn)
              : v.id
          }));
        } catch (e) {
          console.error("[lidParser] error:", e);
          return participants || [];
        }
      };

      installWelcomeSystem(sock);

      for (const plugin of global.plugins) {
        if (typeof plugin.run === "function" && !plugin.command) {
          try {
            plugin.run(sock, { wa: global.wa });
            console.log(chalk.magenta("🧠 Plugin con eventos conectado"));
          } catch (e) {
            console.error(chalk.red("❌ Error al ejecutar evento del plugin:"), e);
          }
        }
      }

      if (!fs.existsSync("./sessions/creds.json") && method === "2") {
        setTimeout(async () => {
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(chalk.magenta("🔑 Código de vinculación: ") + chalk.yellow(code.match(/.{1,4}/g).join("-")));
        }, 2000);
      }

      async function handleIncomingMessage(m) {
        if (!m) return;

        if (!m.message) return;

        await normalizeMessageIdentity(sock, m);

        global.mActual = m;

        const chatId = m.key.remoteJid;
        const sender = m.key.participant || m.key.remoteJid;
        const fromMe = !!m.key.fromMe || sender === sock.user?.id;
        const isGroup = typeof chatId === "string" && chatId.endsWith("@g.us");

        let messageContent = getMessageText(m);

        console.log(chalk.yellow(`\n📩 Nuevo mensaje recibido`));
        console.log(chalk.green(`📨 De: ${fromMe ? "[Tú]" : "[Usuario]"} ${chalk.bold(sender)}`));
        console.log(chalk.cyan(`💬 Tipo: ${Object.keys(m.message || {})[0] || "desconocido"}`));
        console.log(chalk.cyan(`💬 Texto: ${chalk.bold(messageContent || "📂 (Multimedia)")}`));

        /* === STICKER → COMANDO GLOBAL === */
        try {
          const st =
            m.message?.stickerMessage ||
            m.message?.ephemeralMessage?.message?.stickerMessage ||
            null;

          if (st && fs.existsSync("./comandos.json")) {
            const rawSha = st.fileSha256 || st.fileSha256Hash || st.filehash;
            const candidates = [];

            if (rawSha) {
              if (Buffer.isBuffer(rawSha)) {
                candidates.push(rawSha.toString("base64"));
                candidates.push(Array.from(rawSha).toString());
              } else if (ArrayBuffer.isView(rawSha)) {
                const buf = Buffer.from(rawSha);
                candidates.push(buf.toString("base64"));
                candidates.push(Array.from(rawSha).toString());
              } else if (typeof rawSha === "string") {
                candidates.push(rawSha);
              }
            }

            let mapped = null;
            const map = JSON.parse(fs.readFileSync("./comandos.json", "utf-8") || "{}") || {};

            for (const k of candidates) {
              if (k && typeof map[k] === "string" && map[k].trim()) {
                mapped = map[k].trim();
                break;
              }
            }

            if (mapped) {
              const ensurePrefixed = (t) => {
                const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";

                return (Array.isArray(global.prefixes) && global.prefixes.some(p => t.startsWith(p)))
                  ? t
                  : (pref + t);
              };

              const injectedText = ensurePrefixed(mapped);
              const ctx = st.contextInfo || {};

              m.message.extendedTextMessage = {
                text: injectedText,
                contextInfo: {
                  quotedMessage: ctx.quotedMessage || null,
                  participant: ctx.participant || null,
                  stanzaId: ctx.stanzaId || "",
                  remoteJid: ctx.remoteJid || m.key.remoteJid,
                  mentionedJid: Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : []
                }
              };

              messageContent = injectedText;
              m._stickerCmdInjected = true;
              m._stickerCmdText = injectedText;
            }
          }
        } catch (e) {
          console.error("❌ Sticker→cmd error:", e);
        }

        /* === FILTRO PRIVADO + MODO PRIVADO GLOBAL === */
        try {
          const botNumber = getBotNumber(sock);
          const botJid = getBotJid(sock);
          const senderId = isGroup
            ? getJidText(m.key.participant || m.participant || m.sender || "")
            : fromMe
              ? botJid
              : getJidText(m.key.remoteJid || m.sender || "");

          const senderNum = DIGITS(String(senderId).split(":")[0]);
          const isBot = fromMe || (!!botNumber && senderNum === botNumber);
          const isOwner = isOwnerNumber(senderNum);

          const welcomeData = readJSON(path.resolve("setwelcome.json"), {});
          const whitelistNums = Array.isArray(welcomeData.lista)
            ? welcomeData.lista.map(x => DIGITS(x)).filter(Boolean)
            : [];

          const isInPrivateWhitelist = whitelistNums.includes(senderNum);
          const modoPrivado = await getConfigSafe("global", "modoprivado", 0);
          const modoPrivadoActivo = isActive(modoPrivado);

          if (!isGroup) {
            const permitidoPrivado = isBot || isOwner || isInPrivateWhitelist;

            if (!permitidoPrivado) {
              console.log("⛔ PRIVADO BLOQUEADO:", senderNum);
              return;
            }
          }

          if (isGroup && modoPrivadoActivo) {
            const permitidoGrupo = isBot || isOwner;

            if (!permitidoGrupo) {
              console.log("⛔ GRUPO BLOQUEADO POR MODO PRIVADO GLOBAL:", senderNum);
              return;
            }
          }
        } catch (e) {
          console.error("❌ Error en filtro privado/modoprivado:", e);
        }

        /* === IA NATURAL SUKI/BOT === */
        try {
          const senderId = m.key.participant || m.key.remoteJid;
          const textoIA = String(getMessageText(m) || "").trim();
          const tienePrefijo = textoIA && global.prefixes.some(p => textoIA.startsWith(p));

          if (!fromMe && textoIA && !tienePrefijo) {
            const regexSuki = /\b(suki|bot)\b/i;

            if (regexSuki.test(textoIA)) {
              global._sukiIACooldown = global._sukiIACooldown || {};
              const cdKey = `${chatId}:${senderId}`;
              const lastTime = global._sukiIACooldown[cdKey] || 0;
              const now = Date.now();

              if (now - lastTime >= 3000) {
                global._sukiIACooldown[cdKey] = now;

                global._sukiIAHist = global._sukiIAHist || {};
                if (!Array.isArray(global._sukiIAHist[chatId])) {
                  global._sukiIAHist[chatId] = [];
                }

                (async () => {
                  const fsLocal = require("fs");
                  const pathLocal = require("path");
                  const CryptoLocal = require("crypto");
                  const ffmpegLocal = require("fluent-ffmpeg");
                  const axios = require("axios");

                  const tmpDir = pathLocal.resolve("./tmp");
                  if (!fsLocal.existsSync(tmpDir)) fsLocal.mkdirSync(tmpDir, { recursive: true });

                  const rid = CryptoLocal.randomBytes(6).toString("hex");
                  const mp3Path = pathLocal.join(tmpDir, `suki_${rid}.mp3`);
                  const oggPath = pathLocal.join(tmpDir, `suki_${rid}.ogg`);

                  try {
                    try { await sock.sendPresenceUpdate("composing", chatId); } catch {}

                    const API_KEY = "mk-668eddd56d17442cec5c740c2f4471e3a547d197a760717f";

                    const historialPrev = global._sukiIAHist[chatId].slice(-10);
                    let promptCompleto = "";

                    if (historialPrev.length > 0) {
                      promptCompleto += "Conversación previa:\n";

                      for (const msg of historialPrev) {
                        const rol = msg.role === "user" ? "Usuario" : "Suki";
                        promptCompleto += `${rol}: ${msg.content}\n`;
                      }

                      promptCompleto += `\nUsuario: ${textoIA}`;
                    } else {
                      promptCompleto = textoIA;
                    }

                    const systemPrompt = "Eres Suki, una asistente de WhatsApp amigable, divertida y natural. Respondes en español, con mensajes cortos y claros (máximo 2-3 oraciones). Nunca digas que eres una IA ni menciones tu modelo. Actúa como una amiga cercana.";

                    const chatRes = await axios.post(
                      "https://devmatrixs.lat/api/ia",
                      {
                        model: "minimax",
                        prompt: promptCompleto,
                        system: systemPrompt
                      },
                      {
                        headers: {
                          "Content-Type": "application/json",
                          "x-api-key": API_KEY
                        },
                        timeout: 30000,
                        validateStatus: () => true
                      }
                    );

                    const cd = chatRes.data || {};
                    const respuestaTexto = (
                      cd?.respuesta ||
                      cd?.reply ||
                      cd?.response ||
                      cd?.message ||
                      cd?.content ||
                      cd?.result ||
                      cd?.text ||
                      cd?.data?.respuesta ||
                      cd?.data?.reply ||
                      cd?.data?.response ||
                      cd?.data?.message ||
                      cd?.data?.content ||
                      cd?.choices?.[0]?.message?.content ||
                      ""
                    ).toString().trim();

                    if (!respuestaTexto) {
                      try { await sock.sendPresenceUpdate("paused", chatId); } catch {}
                      return;
                    }

                    global._sukiIAHist[chatId].push({ role: "user", content: textoIA });
                    global._sukiIAHist[chatId].push({ role: "assistant", content: respuestaTexto });

                    if (global._sukiIAHist[chatId].length > 10) {
                      global._sukiIAHist[chatId] = global._sukiIAHist[chatId].slice(-10);
                    }

                    try {
                      await sock.sendMessage(chatId, { react: { text: "💬", key: m.key } });
                    } catch {}

                    try { await sock.sendPresenceUpdate("recording", chatId); } catch {}

                    const textoParaAudio = respuestaTexto.slice(0, 500);
                    let audioUrl = "";

                    try {
                      const audioRes = await axios.get(
                        "https://devmatrixs.lat/api/audio",
                        {
                          params: {
                            text: textoParaAudio,
                            voice: "nova"
                          },
                          headers: {
                            "x-api-key": API_KEY
                          },
                          timeout: 30000,
                          validateStatus: () => true
                        }
                      );

                      const ad = audioRes.data || {};
                      audioUrl = ad?.url || ad?.data?.url || ad?.audio || ad?.data?.audio || "";
                    } catch {}

                    if (audioUrl) {
                      try {
                        const audioFile = await axios.get(audioUrl, {
                          responseType: "arraybuffer",
                          timeout: 30000
                        });

                        fsLocal.writeFileSync(mp3Path, Buffer.from(audioFile.data));

                        await new Promise((resolve, reject) => {
                          ffmpegLocal(mp3Path)
                            .audioCodec("libopus")
                            .audioChannels(1)
                            .audioFrequency(48000)
                            .audioBitrate("64k")
                            .outputOptions([
                              "-avoid_negative_ts", "make_zero",
                              "-application", "voip"
                            ])
                            .format("ogg")
                            .on("end", resolve)
                            .on("error", reject)
                            .save(oggPath);
                        });

                        const oggBuffer = fsLocal.readFileSync(oggPath);

                        try { await sock.sendPresenceUpdate("paused", chatId); } catch {}

                        await sock.sendMessage(
                          chatId,
                          {
                            audio: oggBuffer,
                            mimetype: "audio/ogg; codecs=opus",
                            ptt: true
                          },
                          { quoted: m }
                        );

                        try { fsLocal.unlinkSync(mp3Path); } catch {}
                        try { fsLocal.unlinkSync(oggPath); } catch {}

                        return;
                      } catch {
                        try { fsLocal.unlinkSync(mp3Path); } catch {}
                        try { fsLocal.unlinkSync(oggPath); } catch {}
                      }
                    }

                    try { await sock.sendPresenceUpdate("paused", chatId); } catch {}

                    await sock.sendMessage(
                      chatId,
                      { text: respuestaTexto },
                      { quoted: m }
                    );

                  } catch (err) {
                    console.error("[SukiIA] ❌ Error general:", err.message);
                    try { await sock.sendPresenceUpdate("paused", chatId); } catch {}
                    try { fsLocal.unlinkSync(mp3Path); } catch {}
                    try { fsLocal.unlinkSync(oggPath); } catch {}
                  }
                })();
              }
            }
          }
        } catch (e) {
          console.error("❌ Error en lógica IA natural:", e);
        }

        /* === PRESENTACIÓN AUTOMÁTICA === */
        try {
          if (isGroup) {
            const welcomePath = path.resolve("setwelcome.json");

            if (!fs.existsSync(welcomePath)) fs.writeFileSync(welcomePath, "{}");

            const welcomeData = readJSON(welcomePath, {});

            welcomeData[chatId] = welcomeData[chatId] || {};

            if (!welcomeData[chatId].presentationSent) {
              await sock.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/bc06f25b.mp4" },
                caption: `
🎉 ¡Hola a todos! 🎉

👋 Soy *La Suki Bot*, un bot programado 🤖.  
📸 A veces reacciono o envío multimedia porque así me diseñaron.  

⚠️ *Lo que diga no debe ser tomado en serio.* 😉

📌 Usa el comando *.menu* o *.menugrupo* para ver cómo usarme y programar cosas.  
Soy un bot *sencillo y fácil de usar*, ¡gracias por tenerme en el grupo! 💖
                `.trim()
              });

              welcomeData[chatId].presentationSent = true;
              writeJSON(welcomePath, welcomeData);
            }
          }
        } catch (e) {
          console.error("❌ Error en presentación automática:", e);
        }

        /* === CHATGPT POR GRUPO === */
        try {
          const chatgptActivo = await getConfigSafe(chatId, "chatgpt", 0);

          if (isGroup && chatgptActivo == 1 && !fromMe && messageContent.length > 0) {
            const encodedText = encodeURIComponent(messageContent);
            const sessionID = "1727468410446638";
            const apiUrl = `https://api.neoxr.eu/api/gpt4-session?q=${encodedText}&session=${sessionID}&apikey=russellxz`;

            const axios = require("axios");
            const res = await axios.get(apiUrl);
            const respuesta = res.data?.data?.message;

            if (respuesta) {
              await sock.sendMessage(chatId, { text: respuesta }, { quoted: m });
            }
          }
        } catch (e) {
          console.error("❌ Error en lógica ChatGPT por grupo:", e);
        }

        /* === RESPUESTA AUTOMÁTICA PALABRA CLAVE === */
        try {
          const activossPath = path.resolve("./activoss.json");
          const activossData = readJSON(activossPath, {});
          const estadoReacion = String(activossData?.[chatId]?.reacion || "on").toLowerCase();

          if (estadoReacion !== "off") {
            const guarPath = path.resolve("./guar.json");
            const guarFilesPath = path.resolve("./guar_files.json");

            let guarData = readJSON(guarPath, {});

            if (fs.existsSync(guarFilesPath)) {
              try {
                const filesDb = readJSON(guarFilesPath, {});

                for (const k of Object.keys(filesDb)) {
                  if (!Array.isArray(guarData[k])) guarData[k] = [];
                  guarData[k] = guarData[k].concat(filesDb[k]);
                }
              } catch {}
            }

            if (Object.keys(guarData).length > 0) {
              const cleanText = String(messageContent || "")
                .toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                .replace(/[^\w]/g, "");

              for (const key of Object.keys(guarData)) {
                const cleanKey = String(key || "")
                  .toLowerCase()
                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                  .replace(/[^\w]/g, "");

                if (cleanText === cleanKey && guarData[key]?.length) {
                  const item = guarData[key][Math.floor(Math.random() * guarData[key].length)];

                  let buffer = null;

                  if (item.path) {
                    try {
                      const filePath = path.resolve(item.path);
                      if (fs.existsSync(filePath)) buffer = fs.readFileSync(filePath);
                    } catch {}
                  }

                  if (!buffer && item.media) {
                    try {
                      buffer = Buffer.from(item.media, "base64");
                    } catch {}
                  }

                  if (!buffer || !buffer.length) return;

                  const extension = String(item.ext || item.mime?.split("/")?.[1] || "bin").toLowerCase();
                  const mime = item.mime || "";
                  const payload = {};

                  if (["jpg", "jpeg", "png"].includes(extension)) {
                    payload.image = buffer;
                  } else if (["mp4", "mkv", "webm"].includes(extension)) {
                    payload.video = buffer;
                  } else if (["mp3", "ogg", "opus"].includes(extension)) {
                    payload.audio = buffer;
                    payload.mimetype = mime || "audio/mpeg";
                    payload.ptt = false;
                  } else if (["webp"].includes(extension)) {
                    payload.sticker = buffer;
                  } else {
                    payload.document = buffer;
                    payload.mimetype = mime || "application/octet-stream";
                    payload.fileName = item.fileName || `archivo.${extension}`;
                  }

                  await sock.sendMessage(chatId, payload, { quoted: m });
                  return;
                }
              }
            }
          }
        } catch (e) {
          console.error("❌ Error en lógica de palabra clave:", e);
        }

        /* === ANTIS STICKERS === */
        try {
          const stickerMsg =
            m.message?.stickerMessage ||
            m.message?.ephemeralMessage?.message?.stickerMessage;

          if (isGroup && !fromMe && stickerMsg) {
            const antisActivo = await getConfigSafe(chatId, "antis", 0);

            if (antisActivo == 1) {
              const user = m.key.participant || m.key.remoteJid;
              const now = Date.now();

              global.antisSpam = global.antisSpam || {};
              global.antisSpam[chatId] = global.antisSpam[chatId] || {};
              global.antisBlackList = global.antisBlackList || {};

              const userData = global.antisSpam[chatId][user] || {
                count: 0,
                last: now,
                warned: false,
                strikes: 0
              };

              const timePassed = now - userData.last;

              if (timePassed > 15000) {
                userData.count = 1;
                userData.last = now;
                userData.warned = false;
                userData.strikes = 0;

                if (global.antisBlackList[chatId]?.includes(user)) {
                  global.antisBlackList[chatId] = global.antisBlackList[chatId].filter(u => u !== user);
                }
              } else {
                userData.count++;
                userData.last = now;
              }

              global.antisSpam[chatId][user] = userData;

              if (userData.count === 5) {
                await sock.sendMessage(chatId, {
                  text: `⚠️ @${user.split("@")[0]} has enviado *5 stickers*. Espera *15 segundos* o si envías *3 más*, serás eliminado.`,
                  mentions: [user]
                });

                userData.warned = true;
                userData.strikes = 0;
              }

              if (userData.count > 5 && timePassed < 15000) {
                global.antisBlackList[chatId] = global.antisBlackList[chatId] || [];

                if (!global.antisBlackList[chatId].includes(user)) {
                  global.antisBlackList[chatId].push(user);
                }

                await sock.sendMessage(chatId, {
                  delete: {
                    remoteJid: chatId,
                    fromMe: false,
                    id: m.key.id,
                    participant: user
                  }
                });

                userData.strikes++;

                if (userData.strikes >= 3) {
                  await sock.sendMessage(chatId, {
                    text: `❌ @${user.split("@")[0]} fue eliminado por ignorar advertencias y abusar de stickers.`,
                    mentions: [user]
                  });

                  await sock.groupParticipantsUpdate(chatId, [user], "remove");
                  clearGroupMetadataCache(chatId);
                  delete global.antisSpam[chatId][user];
                }
              }

              global.antisSpam[chatId][user] = userData;
            }
          }
        } catch (e) {
          console.error("❌ Error en lógica antis stickers:", e);
        }

        /* === CONTEO DE MENSAJES === */
        try {
          const welcomePath = path.resolve("setwelcome.json");

          if (!fs.existsSync(welcomePath)) {
            writeJSON(welcomePath, {});
          }

          let welcomeData = readJSON(welcomePath, {});

          if (isGroup) {
            welcomeData[chatId] = welcomeData[chatId] || {};
            welcomeData[chatId].chatCount = welcomeData[chatId].chatCount || {};

            const identity = await getSenderIdentity(sock, m);
            const keys = [...identity.numbers];

            if (keys.length) {
              let current = 0;

              for (const key of keys) {
                const val = Number(welcomeData[chatId].chatCount[key] || 0);
                if (val > current) current = val;
              }

              const next = current + 1;

              for (const key of keys) {
                welcomeData[chatId].chatCount[key] = next;
              }

              writeJSON(welcomePath, welcomeData);
            }
          }
        } catch (e) {
          console.error("❌ Error en conteo de mensajes:", e);
        }

        /* === GUARDADO ANTIDELETE === */
        try {
          const { getAntideleteDB, saveAntideleteDB } = requireFromRoot("db");
          const antideleteGroupActive = isGroup ? await getConfigSafe(chatId, "antidelete", 0) == 1 : false;
          const antideletePrivActive = !isGroup ? await getConfigSafe("global", "antideletepri", 0) == 1 : false;

          if (antideleteGroupActive || antideletePrivActive) {
            const idMsg = m.key.id;
            const botJid = getBotJid(sock);
            const senderId = m.key.participant || (m.key.fromMe ? botJid : m.key.remoteJid);
            const type = Object.keys(m.message || {})[0];
            const content = m.message[type];

            if (type === "viewOnceMessageV2") return;

            if (
              ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type) &&
              content.fileLength > 10 * 1024 * 1024
            ) return;

            const guardado = {
              chatId,
              sender: senderId,
              type,
              timestamp: Date.now()
            };

            const saveBase64 = async (mediaType, data) => {
              const stream = await downloadContentFromMessage(data, mediaType);
              let buffer = Buffer.alloc(0);

              for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
              }

              guardado.media = buffer.toString("base64");
              guardado.mimetype = data.mimetype;
            };

            if (["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type)) {
              const mediaType = type.replace("Message", "");
              await saveBase64(mediaType, content);
            }

            if (type === "conversation" || type === "extendedTextMessage") {
              guardado.text = m.message.conversation || m.message.extendedTextMessage?.text || "";
            }

            const db = getAntideleteDB();
            const scope = isGroup ? "g" : "p";

            db[scope][idMsg] = guardado;
            saveAntideleteDB(db);
          }
        } catch (e) {
          console.error("❌ Error en lógica ANTIDELETE:", e);
        }

        /* === DETECCIÓN MENSAJE ELIMINADO === */
        if (m.message?.protocolMessage?.type === 0) {
          try {
            const deletedId = m.message.protocolMessage.key.id;
            const whoDeleted = m.message.protocolMessage.key.participant || m.key.participant || m.key.remoteJid;
            const senderNumber = DIGITS(whoDeleted);
            const mentionTag = [`${senderNumber}@s.whatsapp.net`];

            const antideleteEnabled = isGroup
              ? await getConfigSafe(chatId, "antidelete", 0) == 1
              : await getConfigSafe("global", "antideletepri", 0) == 1;

            if (!antideleteEnabled) return;

            const dbPath = "./antidelete.db";
            if (!fs.existsSync(dbPath)) return;

            const db = JSON.parse(fs.readFileSync(dbPath));
            const tipo = isGroup ? "g" : "p";
            const data = db[tipo] || {};
            const deletedData = data[deletedId];

            if (!deletedData) return;

            const senderClean = DIGITS(deletedData.sender || "");
            if (senderClean !== senderNumber) return;

            if (isGroup) {
              try {
                const meta = await getGroupMetadataCached(sock, chatId);
                const isAdmin = meta.participants.find(p => JID_NUM(p.id || p.jid || p.phoneNumber) === senderNumber)?.admin;
                if (isAdmin) return;
              } catch {
                return;
              }
            }

            const type = deletedData.type;
            const mimetype = deletedData.mimetype || "application/octet-stream";
            const buffer = deletedData.media ? Buffer.from(deletedData.media, "base64") : null;

            if (buffer) {
              const sendOpts = {
                [type.replace("Message", "")]: buffer,
                mimetype
              };

              if (type === "stickerMessage") {
                const sent = await sock.sendMessage(chatId, sendOpts);
                await sock.sendMessage(chatId, {
                  text: `📌 El sticker fue eliminado por @${senderNumber}`,
                  mentions: mentionTag
                }, { quoted: sent });
              } else if (type === "audioMessage") {
                const sent = await sock.sendMessage(chatId, sendOpts);
                await sock.sendMessage(chatId, {
                  text: `🎧 El audio fue eliminado por @${senderNumber}`,
                  mentions: mentionTag
                }, { quoted: sent });
              } else {
                sendOpts.caption = `📦 Mensaje eliminado por @${senderNumber}`;
                sendOpts.mentions = mentionTag;
                await sock.sendMessage(chatId, sendOpts, { quoted: m });
              }
            } else if (deletedData.text) {
              await sock.sendMessage(chatId, {
                text: `📝 *Mensaje eliminado:* ${deletedData.text}\n👤 *Usuario:* @${senderNumber}`,
                mentions: mentionTag
              }, { quoted: m });
            }
          } catch (err) {
            console.error("❌ Error en lógica antidelete:", err);
          }
        }

        /* === ANTILINK === */
        try {
          const antilinkState = await getConfigSafe(chatId, "antilink", 0);

          if (isGroup && parseInt(antilinkState) === 1) {
            const texto = String(messageContent || getMessageText(m) || "");
            const invitaWA = /(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(texto);

            if (invitaWA) {
              const identity = await getSenderIdentity(sock, m);

              const isOwnerHere =
                safeIsOwner(identity.raw) ||
                safeIsOwner(identity.realJid) ||
                safeIsOwner(identity.lidJid) ||
                [...identity.numbers].some(n => safeIsOwner(n));

              const isAdminHere = await isAdminByIdentity(sock, chatId, identity);

              if (!fromMe && !isOwnerHere && !isAdminHere) {
                await deleteMessage(sock, m, chatId, identity);

                const advPath = path.resolve("./advertencias.json");
                const advertencias = readJSON(advPath, {});

                advertencias[chatId] = advertencias[chatId] || {};

                const keys = [...identity.numbers].filter(Boolean);
                let current = 0;

                for (const k of keys) {
                  const n = Number(advertencias[chatId][k] || 0);
                  if (n > current) current = n;
                }

                const total = current + 1;

                for (const k of keys) {
                  advertencias[chatId][k] = total;
                }

                writeJSON(advPath, advertencias);

                if (total >= 3) {
                  await sock.sendMessage(chatId, {
                    text: `❌ @${identity.mentionNum} fue eliminado por enviar invitaciones prohibidas (3/3).`,
                    mentions: [identity.mentionJid]
                  }).catch(() => {});

                  const removed = await removeUser(sock, chatId, identity);

                  if (removed) {
                    for (const k of keys) {
                      advertencias[chatId][k] = 0;
                    }

                    writeJSON(advPath, advertencias);
                  }
                } else {
                  await sock.sendMessage(chatId, {
                    text: `⚠️ @${identity.mentionNum}, enviar invitaciones de WhatsApp no está permitido aquí.\nAdvertencia: ${total}/3.`,
                    mentions: [identity.mentionJid]
                  }).catch(() => {});
                }

                return;
              }
            }
          }
        } catch (e) {
          console.error("❌ Error final en lógica ANTILINK:", e);
        }

        /* === LINKALL === */
        try {
          const estadoLinkAll = await getConfigSafe(chatId, "linkall", 0);

          if (isGroup && parseInt(estadoLinkAll) === 1) {
            const texto = String(messageContent || getMessageText(m) || "");
            const contieneLink = /https?:\/\/[^\s]+/i.test(texto);
            const esWhatsAppGroup = /(?:https?:\/\/)?chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(texto);

            if (contieneLink && !esWhatsAppGroup) {
              const identity = await getSenderIdentity(sock, m);

              const isOwnerHere =
                safeIsOwner(identity.raw) ||
                safeIsOwner(identity.realJid) ||
                safeIsOwner(identity.lidJid) ||
                [...identity.numbers].some(n => safeIsOwner(n));

              const isAdminHere = await isAdminByIdentity(sock, chatId, identity);

              if (!fromMe && !isOwnerHere && !isAdminHere) {
                await deleteMessage(sock, m, chatId, identity);

                const advPath = path.resolve("./advertencias.json");
                const advertencias = readJSON(advPath, {});

                advertencias[chatId] = advertencias[chatId] || {};

                const keys = [...identity.numbers].filter(Boolean);
                let current = 0;

                for (const k of keys) {
                  const n = Number(advertencias[chatId][k] || 0);
                  if (n > current) current = n;
                }

                const total = current + 1;

                for (const k of keys) {
                  advertencias[chatId][k] = total;
                }

                writeJSON(advPath, advertencias);

                if (total >= 10) {
                  await sock.sendMessage(chatId, {
                    text: `❌ @${identity.mentionNum} fue eliminado por enviar enlaces prohibidos (10/10).`,
                    mentions: [identity.mentionJid]
                  }).catch(() => {});

                  const removed = await removeUser(sock, chatId, identity);

                  if (removed) {
                    for (const k of keys) {
                      advertencias[chatId][k] = 0;
                    }

                    writeJSON(advPath, advertencias);
                  }
                } else {
                  await sock.sendMessage(chatId, {
                    text: `⚠️ @${identity.mentionNum}, no se permiten enlaces externos.\nAdvertencia: ${total}/10.`,
                    mentions: [identity.mentionJid]
                  }).catch(() => {});
                }

                return;
              }
            }
          }
        } catch (e) {
          console.error("❌ Error final en lógica LINKALL:", e);
        }

        /* === USUARIOS MUTEADOS === */
        try {
          if (isGroup && !fromMe) {
            const identity = await getSenderIdentity(sock, m);

            const isOwner =
              safeIsOwner(identity.raw) ||
              safeIsOwner(identity.realJid) ||
              safeIsOwner(identity.lidJid) ||
              [...identity.numbers].some(n => safeIsOwner(n));

            if (!isOwner) {
              const welcomePath = path.resolve("setwelcome.json");
              const welcomeData = readJSON(welcomePath, {});
              const mutedRaw = Array.isArray(welcomeData?.[chatId]?.muted)
                ? welcomeData[chatId].muted
                : [];

              const mutedNums = new Set(
                mutedRaw.map(x => DIGITS(x)).filter(Boolean)
              );

              const isMuted = [...identity.numbers].some(n => mutedNums.has(n));

              if (isMuted) {
                global._muteCounter = global._muteCounter || {};

                const stableKey =
                  identity.pnNumber ||
                  identity.lidNumber ||
                  DIGITS(identity.raw) ||
                  String(identity.raw || "unknown");

                const counterKey = `${chatId}:${stableKey}`;
                global._muteCounter[counterKey] = (global._muteCounter[counterKey] || 0) + 1;

                const count = global._muteCounter[counterKey];

                if (count === 8) {
                  await sock.sendMessage(chatId, {
                    text: `⚠️ @${identity.mentionNum}, estás *muteado*. Si sigues enviando mensajes podrías ser eliminado.`,
                    mentions: [identity.mentionJid]
                  }).catch(() => {});
                }

                if (count === 13) {
                  await sock.sendMessage(chatId, {
                    text: `⛔ @${identity.mentionNum}, estás al *límite*. Un mensaje más y serás eliminado.`,
                    mentions: [identity.mentionJid]
                  }).catch(() => {});
                }

                if (count >= 15) {
                  const isAdmin = await isAdminByIdentity(sock, chatId, identity);

                  if (!isAdmin) {
                    const removed = await removeUser(sock, chatId, identity);

                    if (removed) {
                      await sock.sendMessage(chatId, {
                        text: `❌ @${identity.mentionNum} fue eliminado por ignorar el mute.`,
                        mentions: [identity.mentionJid]
                      }).catch(() => {});

                      delete global._muteCounter[counterKey];
                    }
                  } else if (count === 15 || count % 10 === 0) {
                    await sock.sendMessage(chatId, {
                      text: `🔇 @${identity.mentionNum} está muteado pero no puede ser eliminado por ser admin.`,
                      mentions: [identity.mentionJid]
                    }).catch(() => {});
                  }
                }

                await deleteMessage(sock, m, chatId, identity);
                return;
              }
            }
          }
        } catch (err) {
          console.error("❌ Error en lógica de muteo:", err);
        }

        /* === BLOQUEO USUARIOS BANEADOS === */
        try {
          const senderRaw = m.key.participant || m.key.remoteJid;
          const isFromMe = !!m.key.fromMe;

          const prefixes = Array.isArray(global.prefixes)
            ? global.prefixes
            : [global.prefix || "."];

          const prefixUsed = prefixes.find((p) => {
            if (!p) return false;
            return messageContent?.startsWith(String(p));
          });

          if (prefixUsed) {
            const identity = await getSenderIdentity(sock, m);

            const isOwner =
              safeIsOwner(senderRaw) ||
              safeIsOwner(identity.realJid) ||
              safeIsOwner(identity.lidJid) ||
              [...identity.numbers].some(n => safeIsOwner(n));

            const welcomePath = path.resolve("./setwelcome.json");
            const welcomeData = readJSON(welcomePath, {});
            const chatBanList = Array.isArray(welcomeData?.[chatId]?.banned)
              ? welcomeData[chatId].banned
              : [];

            const bannedNums = new Set(
              chatBanList.map(x => DIGITS(x)).filter(Boolean)
            );

            const isBanned = [...identity.numbers].some(n => bannedNums.has(n));

            if (isBanned && !isOwner && !isFromMe) {
              const frases = [
                "🚫 @usuario estás baneado por pendejo. ¡Abusaste demasiado del bot!",
                "❌ Lo siento @usuario, pero tú ya no puedes usarme. Aprende a comportarte.",
                "🔒 No tienes permiso @usuario. Fuiste baneado por molestar mucho.",
                "👎 ¡Bloqueado! @usuario abusaste del sistema y ahora no puedes usarme.",
                "😤 Quisiste usarme pero estás baneado, @usuario. Vuelve en otra vida."
              ];

              const texto = frases[Math.floor(Math.random() * frases.length)]
                .replace("@usuario", `@${identity.mentionNum}`);

              await sock.sendMessage(chatId, {
                text: texto,
                mentions: [identity.mentionJid]
              }, { quoted: m });

              return;
            }
          }
        } catch (e) {
          console.error("❌ Error procesando bloqueo de usuarios baneados:", e);
        }

        /* === APAGADO POR GRUPO === */
        try {
          if (isGroup) {
            const identity = await getSenderIdentity(sock, m);
            const isOwner = [...identity.numbers].some(n => isOwnerNumber(n));
            const apagado = await getConfigSafe(chatId, "apagado", 0);

            if (apagado == 1 && !isOwner) return;
          }
        } catch (e) {
          console.error("❌ Error en lógica de apagado por grupo:", e);
        }

        /* === COMANDOS RESTRINGIDOS POR GRUPO === */
        try {
          const senderId = m.key.participant || m.key.remoteJid;
          const senderNum = DIGITS(senderId);
          const isOwner = global.isOwner(senderId);
          const isBot = senderId === sock.user.id;
          const isFromMe = m.key.fromMe;

          const prefixUsed = global.prefixes.find(p => messageContent.startsWith(p));
          if (!prefixUsed) return;

          const command = messageContent.slice(prefixUsed.length).trim().split(" ")[0].toLowerCase();

          const welcomePath = path.resolve("setwelcome.json");
          const welcomeData = readJSON(welcomePath, {});
          const restringidos = welcomeData[chatId]?.restringidos || [];

          if (restringidos.includes(command)) {
            if (!isOwner && !isFromMe && !isBot) {
              global.reintentosRestrict = global.reintentosRestrict || {};
              const key = `${chatId}:${senderId}:${command}`;
              global.reintentosRestrict[key] = (global.reintentosRestrict[key] || 0) + 1;

              const intentos = global.reintentosRestrict[key];

              if (intentos <= 2) {
                await sock.sendMessage(chatId, {
                  text: `🚫 *Este comando está restringido en este grupo.*\nSolo el *dueño del bot* y el *bot* pueden usarlo.`
                }, { quoted: m });
              }

              if (intentos === 3) {
                await sock.sendMessage(chatId, {
                  text: `⚠️ @${senderNum} *este es tu intento 3* usando un comando restringido.\n💥 Si lo haces *una vez más*, serás *ignorado para este comando*.`,
                  mentions: [senderId]
                }, { quoted: m });
              }

              if (intentos >= 4) {
                console.log(`🔇 Ignorando a ${senderId} para el comando restringido: ${command}`);
                return;
              }

              return;
            }
          }
        } catch (e) {
          console.error("❌ Error en lógica de comandos restringidos:", e);
        }

        /* === MODOADMINS === */
        if (isGroup) {
          try {
            const estadoModoAdmins = await getConfigSafe(chatId, "modoadmins", 0);

            if (parseInt(estadoModoAdmins) === 1) {
              const identity = await getSenderIdentity(sock, m);

              const isOwner =
                [...identity.numbers].some(n => isOwnerNumber(n));

              const isAdmin = await isAdminByIdentity(sock, chatId, identity);

              console.log("[modoAdmins] sender:", identity.mentionNum);
              console.log("[modoAdmins] isAdmin:", isAdmin, "| isOwner:", isOwner);

              if (!isAdmin && !isOwner && !fromMe) return;
            }
          } catch (e) {
            console.error("❌ Error verificando modoAdmins:", e);
            return;
          }
        }

        /* === EJECUTAR COMANDOS === */
        const prefixUsed = global.prefixes.find(p => messageContent.startsWith(p));
        if (!prefixUsed) return;

        const command = messageContent.slice(prefixUsed.length).trim().split(" ")[0].toLowerCase();
        const rawArgs = messageContent.trim().slice(prefixUsed.length + command.length).trim();
        const args = rawArgs.length ? rawArgs.split(/\s+/) : [];

        for (const plugin of global.plugins) {
          const isClassic = typeof plugin === "function";
          const isCompatible = plugin.command?.includes?.(command);

          try {
            if (isClassic && plugin.command?.includes?.(command)) {
              await plugin(m, { conn: sock, text: rawArgs, args, command });
              break;
            }

            if (!isClassic && isCompatible) {
              await plugin.run({ msg: m, conn: sock, args, command });
              break;
            }
          } catch (e) {
            console.error(chalk.red(`❌ Error ejecutando ${command}:`), e);
          }
        }
      }

      sock.ev.on("messages.upsert", async ({ messages }) => {
        try {
          for (const m of messages || []) {
            await handleIncomingMessage(m);
          }
        } catch (e) {
          console.error("❌ Error general en messages.upsert:", e);
        }
      });

      sock.ev.on("connection.update", async ({ connection }) => {
        if (connection === "open") {
          console.log(chalk.green("✅ Conectado correctamente a WhatsApp."));

          const restarterFile = "./lastRestarter.json";

          if (fs.existsSync(restarterFile)) {
            try {
              const data = JSON.parse(fs.readFileSync(restarterFile, "utf-8"));

              if (data.chatId) {
                await sock.sendMessage(data.chatId, {
                  text: "✅ *Suki Bot 3.0 está en línea nuevamente* 🚀"
                });

                console.log(chalk.yellow("📢 Aviso enviado al grupo del reinicio."));
                fs.unlinkSync(restarterFile);
              }
            } catch (error) {
              console.error("❌ Error leyendo lastRestarter.json:", error);
            }
          }
        } else if (connection === "close") {
          console.log(chalk.red("❌ Conexión cerrada. Reintentando en 5 segundos..."));
          setTimeout(startBot, 5000);
        }
      });

      sock.ev.on("creds.update", saveCreds);

      process.on("uncaughtException", (err) => {
        console.error(chalk.red("⚠️ Error no capturado:"), err);
      });

      process.on("unhandledRejection", (reason, promise) => {
        console.error(chalk.red("🚨 Promesa sin manejar:"), promise, "Razón:", reason);
      });

    } catch (e) {
      console.error(chalk.red("❌ Error en conexión:"), e);
      setTimeout(startBot, 5000);
    }
  }

  startBot();
})();
