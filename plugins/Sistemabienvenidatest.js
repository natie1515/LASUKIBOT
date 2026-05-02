const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

// Cache global de admins por chat
const adminCache = {};

// Evita duplicados cuando Baileys dispara native + stub al mismo tiempo
const recentEvents = new Map();
const RECENT_EVENT_TTL_MS = 8000;

// Mapa global LID <-> PN
if (!(global.lidMap instanceof Map)) {
  global.lidMap = new Map();
}

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

async function getConfigSafe(chatId, key, fallback = 0) {
  try {
    const value = getConfig(chatId, key);

    if (value && typeof value.then === "function") {
      const resolved = await value;
      return resolved ?? fallback;
    }

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

function tryParseJsonObject(value) {
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

// ✅ Convierte cualquier cosa a texto JID seguro.
// Soporta string, objeto de Baileys, JSON string, LID, JID real, pn, jid, id, phoneNumber, etc.
function getJidStr(obj) {
  if (!obj) return "";

  if (typeof obj === "string") {
    if (obj === "[object Object]") return "";

    const parsed = tryParseJsonObject(obj);
    if (parsed) return getJidStr(parsed);

    return obj;
  }

  if (typeof obj === "number") return String(obj);

  if (typeof obj === "object") {
    return String(
      obj.jid ||
      obj.phoneNumber ||
      obj.pn ||
      obj.id ||
      obj.lid ||
      obj.participant ||
      obj.participantPn ||
      obj.participantLid ||
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

  if (jid.includes(":") && jid.includes("@lid")) {
    const num = jid.split(":")[0].replace(/[^0-9]/g, "");
    return num ? `${num}@lid` : jid;
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

function normalizePhoneJid(value = "") {
  const text = cleanJid(value);
  if (!text) return "";

  if (text.endsWith("@s.whatsapp.net")) return text;

  const n = DIGITS(text);
  return n ? `${n}@s.whatsapp.net` : "";
}

function normalizeLidJid(value = "") {
  const text = cleanJid(value);
  if (!text) return "";

  if (text.endsWith("@lid")) return text;

  return "";
}

function rememberLidPn(lid, pn) {
  lid = cleanJid(lid || "");
  pn = cleanJid(pn || "");

  if (!lid || !pn) return;
  if (!lid.endsWith("@lid")) return;
  if (!pn.endsWith("@s.whatsapp.net")) return;

  global.lidMap.set(lid, pn);
  global.lidMap.set(pn, lid);
}

function rememberFromAnyParticipant(p) {
  if (!p || typeof p !== "object") return;

  const lid =
    normalizeLidJid(p.lid) ||
    normalizeLidJid(p.id) ||
    normalizeLidJid(p.participantLid);

  const pn =
    normalizePhoneJid(p.phoneNumber) ||
    normalizePhoneJid(p.jid) ||
    normalizePhoneJid(p.pn) ||
    normalizePhoneJid(p.participantPn);

  if (lid && pn) rememberLidPn(lid, pn);
}

function sameJid(a, b) {
  a = cleanJid(a);
  b = cleanJid(b);

  if (!a || !b) return false;
  if (a === b) return true;

  if (a.endsWith("@s.whatsapp.net") && b.endsWith("@s.whatsapp.net")) {
    return jidNumber(a) === jidNumber(b);
  }

  return false;
}

function candidatesMatch(a = [], b = []) {
  for (const x of a) {
    for (const y of b) {
      if (sameJid(x, y)) return true;
    }
  }

  return false;
}

function getParticipantCandidates(value) {
  const out = [];

  function add(v) {
    const text = cleanJid(v);
    if (text && text !== "[object Object]" && !out.includes(text)) out.push(text);
  }

  if (!value) return out;

  if (typeof value === "string") {
    const parsed = tryParseJsonObject(value);

    if (parsed) {
      return getParticipantCandidates(parsed);
    }

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
    add(value.participantPn);
    add(value.participantLid);
    add(value.user);
    add(value._serialized);

    const n = DIGITS(
      value.phoneNumber ||
      value.pn ||
      value.jid ||
      value.participantPn ||
      value.user ||
      ""
    );

    if (n) add(makeRealJid(n));
  }

  return out;
}

/** Si id es @lid y existe .jid o .phoneNumber real, usa el real */
function lidParser(participants = []) {
  try {
    return participants.map(v => {
      if (typeof v === "string") {
        return {
          id: cleanJid(v),
          admin: null,
          raw: v
        };
      }

      return {
        id: (
          typeof v?.id === "string" &&
          v.id.endsWith("@lid") &&
          (
            typeof v?.jid === "string" ||
            typeof v?.phoneNumber === "string" ||
            typeof v?.pn === "string"
          )
        )
          ? cleanJid(v.jid || v.phoneNumber || v.pn)
          : cleanJid(getJidStr(v)),
        admin: v?.admin ?? null,
        raw: v
      };
    });
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

        if (resolved && String(resolved).endsWith("@lid")) {
          out.lidJid = cleanJid(resolved);
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

    const match = candidatesMatch(candidates, allIds);

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

    if (typeof p?.phoneNumber === "string" && p.phoneNumber.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(p.phoneNumber);
      out.number = jidNumber(p.phoneNumber);
    }

    if (typeof p?.pn === "string" && p.pn.endsWith("@s.whatsapp.net")) {
      out.realJid = cleanJid(p.pn);
      out.number = jidNumber(p.pn);
    }

    if (typeof p?.id === "string" && p.id.endsWith("@lid")) {
      out.lidJid = p.id;
    }

    rememberFromAnyParticipant(p);

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

    if (candidatesMatch(candidates, ids)) {
      return p;
    }
  }

  return null;
}

async function getPnForLidSafe(conn, lid) {
  lid = normalizeLidJid(lid);
  if (!lid) return "";

  try {
    const cached = global.lidMap instanceof Map ? global.lidMap.get(lid) : "";
    if (cached && String(cached).endsWith("@s.whatsapp.net")) {
      return cleanJid(cached);
    }
  } catch {}

  try {
    const pn = await conn?.signalRepository?.lidMapping?.getPNForLID?.(lid);
    const real = normalizePhoneJid(pn);
    if (real) rememberLidPn(lid, real);
    return real;
  } catch {}

  return "";
}

async function getLidForPnSafe(conn, pn) {
  pn = normalizePhoneJid(pn);
  if (!pn) return "";

  try {
    const cached = global.lidMap instanceof Map ? global.lidMap.get(pn) : "";
    if (cached && String(cached).endsWith("@lid")) {
      return cleanJid(cached);
    }
  } catch {}

  try {
    const lid = await conn?.signalRepository?.lidMapping?.getLIDForPN?.(pn);
    const lidJid = normalizeLidJid(lid);
    if (lidJid) rememberLidPn(lidJid, pn);
    return lidJid;
  } catch {}

  return "";
}

async function resolveParticipant(conn, meta, anyJid) {
  const rawParticipants = Array.isArray(meta?.participants) ? meta.participants : [];

  for (const x of rawParticipants) {
    rememberFromAnyParticipant(x);
  }

  rememberFromAnyParticipant(anyJid);

  const candidates = getParticipantCandidates(anyJid);

  const out = {
    raw: anyJid,
    candidates: [...candidates],
    id: cleanJid(getJidStr(anyJid)),
    realJid: "",
    lidJid: "",
    number: "",
    numberTrusted: false,
    mentionJid: "",
    tag: "@usuario",
    info: null
  };

  for (const c of candidates) {
    if (c.endsWith("@s.whatsapp.net")) {
      out.realJid = normalizePhoneJid(c);
      out.number = jidNumber(out.realJid);
      out.numberTrusted = true;
    }

    if (c.endsWith("@lid")) {
      out.lidJid = normalizeLidJid(c);
    }
  }

  // Buscar match exacto en metadata
  for (const p of rawParticipants) {
    const pCandidates = getParticipantCandidates(p);

    if (!candidatesMatch(candidates, pCandidates)) continue;

    out.info = p;

    for (const c of pCandidates) {
      if (c.endsWith("@s.whatsapp.net")) {
        out.realJid = normalizePhoneJid(c);
        out.number = jidNumber(out.realJid);
        out.numberTrusted = true;
      }

      if (c.endsWith("@lid")) {
        out.lidJid = normalizeLidJid(c);
      }
    }

    rememberFromAnyParticipant(p);
    break;
  }

  // Resolver por mapa global
  try {
    if (global.lidMap instanceof Map) {
      if (!out.realJid && out.lidJid) {
        const pn = global.lidMap.get(out.lidJid);
        if (pn) {
          out.realJid = normalizePhoneJid(pn);
          out.number = jidNumber(out.realJid);
          out.numberTrusted = !!out.number;
        }
      }

      if (!out.lidJid && out.realJid) {
        const lid = global.lidMap.get(out.realJid);
        if (lid) out.lidJid = normalizeLidJid(lid);
      }
    }
  } catch {}

  // Resolver usando signalRepository si existe
  if (!out.realJid && out.lidJid) {
    const pn = await getPnForLidSafe(conn, out.lidJid);
    if (pn) {
      out.realJid = pn;
      out.number = jidNumber(pn);
      out.numberTrusted = !!out.number;
    }
  }

  if (!out.lidJid && out.realJid) {
    const lid = await getLidForPnSafe(conn, out.realJid);
    if (lid) out.lidJid = lid;
  }

  out.mentionJid =
    out.realJid ||
    out.lidJid ||
    candidates.find(x => x.endsWith("@s.whatsapp.net")) ||
    candidates.find(x => x.endsWith("@lid")) ||
    out.id ||
    "";

  if (out.numberTrusted && out.number) {
    out.tag = `@${out.number}`;
  } else {
    const fakeNum = DIGITS(out.mentionJid);
    out.tag = fakeNum ? `@${fakeNum}` : "@usuario";
  }

  return out;
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

// ==== FALLBACK PARA EVENTOS NUEVOS DE BAILEYS POR STUB ====

function parseStubParticipantParam(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const parsed = tryParseJsonObject(value);

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

  if (
    n === 27 ||
    s.includes("group_participant_add") ||
    s.includes("participant_add")
  ) return "add";

  if (
    n === 28 ||
    n === 32 ||
    s.includes("group_participant_remove") ||
    s.includes("group_participant_leave") ||
    s.includes("participant_remove") ||
    s.includes("participant_leave")
  ) return "remove";

  if (
    n === 29 ||
    s.includes("group_participant_promote") ||
    s.includes("participant_promote")
  ) return "promote";

  if (
    n === 30 ||
    s.includes("group_participant_demote") ||
    s.includes("participant_demote")
  ) return "demote";

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

  let participants = params
    .map(parseStubParticipantParam)
    .filter(Boolean)
    .filter(x => {
      const ids = getParticipantCandidates(x);
      return ids.some(id =>
        id.endsWith("@s.whatsapp.net") ||
        id.endsWith("@lid")
      );
    });

  // Fallback extra por si el stub viene raro y no trae params bien
  if (!participants.length) {
    const possible = [
      m.participant,
      m.key?.participant,
      m.key?.participantPn,
      m.key?.participantLid
    ]
      .map(parseStubParticipantParam)
      .filter(Boolean);

    participants = possible.filter(x => {
      const ids = getParticipantCandidates(x);
      return ids.some(id =>
        id.endsWith("@s.whatsapp.net") ||
        id.endsWith("@lid")
      );
    });
  }

  if (!participants.length) return null;

  const author =
    cleanJid(m.key?.participant || m.participant || m.key?.participantLid || "") ||
    "";

  const authorPn =
    cleanJid(m.key?.participantPn || "") ||
    "";

  return {
    id: chatId,
    action,
    participants,
    author,
    authorPn,
    fromStub: true,
    stubType: m.messageStubType,
    stubRawType: m.type || ""
  };
}

function makeResolvedDedupKey(chatId, action, resolvedParticipants = []) {
  const ids = resolvedParticipants
    .map(u => {
      return (
        u.realJid ||
        u.lidJid ||
        u.mentionJid ||
        u.id ||
        JSON.stringify(u.raw || "")
      );
    })
    .map(cleanJid)
    .filter(Boolean)
    .sort();

  return `${cleanJid(chatId)}|${String(action).toLowerCase()}|${ids.join(",")}`;
}

function shouldSkipDuplicateResolved(chatId, action, resolvedParticipants = []) {
  const key = makeResolvedDedupKey(chatId, action, resolvedParticipants);
  const now = Date.now();

  for (const [k, t] of recentEvents.entries()) {
    if (now - t > RECENT_EVENT_TTL_MS) {
      recentEvents.delete(k);
    }
  }

  if (recentEvents.has(key)) return true;

  recentEvents.set(key, now);
  return false;
}

async function removeParticipantSmart(conn, chatId, user) {
  const tries = [
    user.realJid,
    user.lidJid,
    user.mentionJid,
    user.id,
    ...(Array.isArray(user.candidates) ? user.candidates : [])
  ]
    .map(cleanJid)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  for (const jid of tries) {
    try {
      await conn.groupParticipantsUpdate(chatId, [jid], "remove");
      return true;
    } catch (e) {
      console.log("⚠️ Falló expulsión con:", jid, e.message);
    }
  }

  return false;
}

// ==== LÓGICA PRINCIPAL ====

async function handleGroupParticipantsUpdate(conn, update) {
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
    console.log(update?.fromStub ? "🧩 EVENTO DE PARTICIPANTES POR STUB" : "👥 EVENTO DE PARTICIPANTES");
    console.log("➡️ Grupo:", chatId);
    console.log("➡️ Acción:", action);
    console.log("➡️ Participantes:", participants.length);

    if (update?.fromStub) {
      console.log("➡️ StubType:", update.stubType);
      console.log("➡️ Tipo:", update.stubRawType || "N/A");
    }

    const metadata = await conn.groupMetadata(chatId).catch((e) => {
      console.log("⚠️ No se pudo leer metadata del grupo:", e.message);
      return null;
    });

    if (!metadata) return;

    const resolvedParticipants = [];

    for (const pRaw of participants) {
      const resolved = await resolveParticipant(conn, metadata, pRaw);

      if (!resolved.mentionJid) {
        console.log("⚠️ Participante sin JID válido. Ignorado:", pRaw);
        continue;
      }

      resolvedParticipants.push(resolved);
    }

    if (!resolvedParticipants.length) {
      console.log("⚠️ No se pudo resolver ningún participante:", participants);
      return;
    }

    // Deduplicar DESPUÉS de resolver PN/LID
    if (shouldSkipDuplicateResolved(chatId, action, resolvedParticipants)) {
      console.log("♻️ Evento duplicado ignorado:", action, chatId);
      return;
    }

    // Actualizar cache de admins con metadata actual
    adminCache[chatId] = new Set(
      metadata.participants
        .filter(p => p.admin === "admin" || p.admin === "superadmin")
        .map(p => {
          const ids = getParticipantCandidates(p);
          return (
            ids.find(x => x.endsWith("@s.whatsapp.net")) ||
            ids.find(x => x.endsWith("@lid")) ||
            cleanJid(getJidStr(p))
          );
        })
        .filter(Boolean)
    );

    const welcomeActive = await getConfigSafe(chatId, "welcome", 0);
    const byeActive = await getConfigSafe(chatId, "despedidas", 0);
    const antiArabe = await getConfigSafe(chatId, "antiarabe", 0);

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
      const actorRaw = {
        id: update?.author || "",
        jid: update?.authorPn || "",
        phoneNumber: update?.authorPn || "",
        pn: update?.authorPn || "",
        lid: update?.author || ""
      };

      const actor = await resolveParticipant(conn, metadata, actorRaw);

      const actorMention = actor.mentionJid || null;
      const actorNum =
        actor.number ||
        jidNumber(actorMention || "") ||
        "Desconocido";

      for (const target of resolvedParticipants) {
        const targetMention = target.mentionJid;
        const targetNum =
          target.number ||
          jidNumber(targetMention) ||
          "Desconocido";

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

          console.log("✅ Aviso promote enviado:", targetMention);
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

          console.log("✅ Aviso demote enviado:", targetMention);
        }
      }

      const newMeta = await conn.groupMetadata(chatId).catch(() => null);

      if (newMeta) {
        adminCache[chatId] = new Set(
          newMeta.participants
            .filter(p => p.admin === "admin" || p.admin === "superadmin")
            .map(p => {
              const ids = getParticipantCandidates(p);
              return (
                ids.find(x => x.endsWith("@s.whatsapp.net")) ||
                ids.find(x => x.endsWith("@lid")) ||
                cleanJid(getJidStr(p))
              );
            })
            .filter(Boolean)
        );
      }

      return;
    }

    // 🔄 SISTEMA DE BIENVENIDAS, DESPEDIDAS Y ANTIÁRABE
    for (const user of resolvedParticipants) {
      const mentionId = String(user.mentionJid || "");

      if (!mentionId) {
        console.log("⚠️ Participante sin JID válido. Ignorado:", user.raw);
        continue;
      }

      const phoneForMention =
        user.number ||
        jidNumber(mentionId) ||
        "usuario";

      const mention = phoneForMention === "usuario"
        ? "@usuario"
        : `@${phoneForMention}`;

      if (action === "add") {
        const isArabic =
          isActive(antiArabe) &&
          user.numberTrusted &&
          user.number &&
          arabes.some(cc => user.number.startsWith(cc));

        if (isActive(antiArabe) && !user.numberTrusted) {
          console.log("⚪ Antiárabe no pudo verificar prefijo porque solo llegó LID:", {
            lid: user.lidJid,
            mention: user.mentionJid
          });
        }

        if (isArabic) {
          const info = user.info || findParticipantInfo(metadata, user.raw);
          const isAdmin = info?.admin === "admin" || info?.admin === "superadmin";
          const isOwner = isOwnerNumber(user.number);

          if (!isAdmin && !isOwner) {
            await conn.sendMessage(chatId, {
              text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
              mentions: [mentionId]
            });

            const removed = await removeParticipantSmart(conn, chatId, user);

            if (!removed) {
              console.log("⚠️ No se pudo expulsar antiárabe:", user);
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
          user.realJid || user.lidJid || mentionId,
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
          user.realJid || user.lidJid || mentionId,
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
          .map(p => {
            const ids = getParticipantCandidates(p);
            return (
              ids.find(x => x.endsWith("@s.whatsapp.net")) ||
              ids.find(x => x.endsWith("@lid")) ||
              cleanJid(getJidStr(p))
            );
          })
          .filter(Boolean)
      );
    }

  } catch (err) {
    console.error("❌ Error en lógica de grupo:", err);
  }
}

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

  // Guarda mappings LID ↔ PN cuando Baileys los mande
  conn.ev.on("lid-mapping.update", async (mapping) => {
    try {
      const list = Array.isArray(mapping) ? mapping : [mapping];

      for (const item of list) {
        const lid = cleanJid(item?.lid || item?.id || "");
        const pn = cleanJid(item?.pn || item?.jid || item?.phoneNumber || "");

        if (lid && pn) {
          rememberLidPn(lid, pn);
          console.log("🔗 LID mapping guardado:", lid, "=>", pn);
        }
      }
    } catch (e) {
      console.log("⚠️ Error guardando lid-mapping.update:", e.message);
    }
  });

  // Listener normal de Baileys
  conn.ev.on("group-participants.update", async (update) => {
    await handleGroupParticipantsUpdate(conn, update);
  });

  // Fallback nuevo: algunos Baileys ahora mandan add/remove/promote/demote como messageStubType en messages.upsert
  conn.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const m of messages || []) {
        const fakeUpdate = buildUpdateFromStubMessage(m);
        if (!fakeUpdate) continue;

        await handleGroupParticipantsUpdate(conn, fakeUpdate);
      }
    } catch (e) {
      console.log("❌ Error en fallback messages.upsert para participantes:", e.message);
    }
  });

  console.log("✅ Listener viejo de bienvenidas/despedidas cargado correctamente.");
  console.log("✅ Fallback de eventos por messageStubType activado correctamente.");
  console.log("✅ Compatibilidad LID/PN para Baileys nueva activada correctamente.");
};

handler.run = handler;
module.exports = handler;
