// TEST DIRECTO: bienvenidas, despedidas, promote/demote y antiarabe
// Este plugin NO depende de configs. Siempre está activo para probar eventos de Baileys.

function digits(s = "") {
  return String(s || "").replace(/[^0-9]/g, "");
}

function cleanJid(jid = "") {
  jid = String(jid || "").trim();

  if (jid.includes(":") && jid.includes("@s.whatsapp.net")) {
    const n = jid.split(":")[0].replace(/[^0-9]/g, "");
    return n ? `${n}@s.whatsapp.net` : jid;
  }

  if (jid.includes(":") && jid.includes("@lid")) {
    const n = jid.split(":")[0].replace(/[^0-9]/g, "");
    return n ? `${n}@lid` : jid;
  }

  return jid;
}

function isUser(jid = "") {
  return String(jid || "").endsWith("@s.whatsapp.net");
}

function isLid(jid = "") {
  return String(jid || "").endsWith("@lid");
}

function parseMaybeJson(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const clean = value.trim();

    if (clean.startsWith("{") && clean.endsWith("}")) {
      try {
        return JSON.parse(clean);
      } catch {}
    }

    return { id: cleanJid(clean) };
  }

  if (typeof value === "object") return value;

  return { id: cleanJid(value) };
}

function getCandidates(value) {
  const obj = parseMaybeJson(value);
  const out = [];

  function add(v) {
    const jid = cleanJid(v);
    if (jid && !out.includes(jid)) out.push(jid);
  }

  if (!obj) return out;

  if (typeof obj === "string") {
    add(obj);
    return out;
  }

  add(obj.id);
  add(obj.jid);
  add(obj.phoneNumber);
  add(obj.pn);
  add(obj.lid);
  add(obj.participant);
  add(obj.participantPn);
  add(obj.participantLid);
  add(obj.user);
  add(obj._serialized);

  return out;
}

function rememberLidPn(lid, pn) {
  global.lidMap = global.lidMap instanceof Map ? global.lidMap : new Map();

  lid = cleanJid(lid);
  pn = cleanJid(pn);

  if (isLid(lid) && isUser(pn)) {
    global.lidMap.set(lid, pn);
    global.lidMap.set(pn, lid);
  }
}

async function resolveUser(conn, raw) {
  global.lidMap = global.lidMap instanceof Map ? global.lidMap : new Map();

  const candidates = getCandidates(raw);

  let realJid = candidates.find(isUser) || "";
  let lidJid = candidates.find(isLid) || "";

  if (!realJid && lidJid) {
    const mapped = global.lidMap.get(lidJid);
    if (isUser(mapped)) realJid = cleanJid(mapped);
  }

  if (!lidJid && realJid) {
    const mapped = global.lidMap.get(realJid);
    if (isLid(mapped)) lidJid = cleanJid(mapped);
  }

  if (!realJid && lidJid) {
    try {
      const pn = await conn.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
      if (isUser(pn)) {
        realJid = cleanJid(pn);
        rememberLidPn(lidJid, realJid);
      }
    } catch {}
  }

  if (!lidJid && realJid) {
    try {
      const lid = await conn.signalRepository?.lidMapping?.getLIDForPN?.(realJid);
      if (isLid(lid)) {
        lidJid = cleanJid(lid);
        rememberLidPn(lidJid, realJid);
      }
    } catch {}
  }

  const mentionJid = realJid || lidJid || candidates[0] || "";
  const number = realJid ? digits(realJid) : digits(mentionJid);

  return {
    raw,
    candidates,
    realJid,
    lidJid,
    mentionJid,
    number: number || "usuario",
    numberTrusted: !!realJid
  };
}

function actionFromStub(m = {}) {
  const n = Number(m.messageStubType);
  const s = String(m.messageStubType || m.type || "").toLowerCase();

  if (n === 27 || s.includes("group_participant_add") || s.includes("participant_add")) return "add";
  if (n === 28 || n === 32 || s.includes("group_participant_remove") || s.includes("participant_remove") || s.includes("participant_leave") || s.includes("leave")) return "remove";
  if (n === 29 || s.includes("group_participant_promote") || s.includes("participant_promote")) return "promote";
  if (n === 30 || s.includes("group_participant_demote") || s.includes("participant_demote")) return "demote";

  return "";
}

function normalizeUpdateFromStub(m = {}) {
  const chatId = cleanJid(m.key?.remoteJid || "");
  if (!chatId.endsWith("@g.us")) return null;

  const action = actionFromStub(m);
  if (!action) return null;

  const params = Array.isArray(m.messageStubParameters) ? m.messageStubParameters : [];
  const participants = params
    .map(parseMaybeJson)
    .filter(Boolean)
    .filter(x => getCandidates(x).some(j => isUser(j) || isLid(j)));

  if (!participants.length) return null;

  return {
    id: chatId,
    action,
    participants,
    author: cleanJid(m.key?.participant || m.participant || m.key?.participantLid || ""),
    authorPn: cleanJid(m.key?.participantPn || ""),
    fromStub: true,
    stubType: m.messageStubType
  };
}

function dedupKey(chatId, action, users) {
  const ids = users
    .map(u => u.realJid || u.lidJid || u.mentionJid || JSON.stringify(u.raw || ""))
    .map(cleanJid)
    .filter(Boolean)
    .sort()
    .join(",");

  return `${chatId}|${action}|${ids}`;
}

function shouldSkip(chatId, action, users) {
  global._sukiGroupEventsDebugDedup = global._sukiGroupEventsDebugDedup || new Map();

  const now = Date.now();
  const key = dedupKey(chatId, action, users);

  for (const [k, t] of global._sukiGroupEventsDebugDedup.entries()) {
    if (now - t > 8000) global._sukiGroupEventsDebugDedup.delete(k);
  }

  if (global._sukiGroupEventsDebugDedup.has(key)) return true;

  global._sukiGroupEventsDebugDedup.set(key, now);
  return false;
}

async function handleGroupEvent(conn, update = {}) {
  const chatId = cleanJid(update.id || "");
  const action = String(update.action || "").toLowerCase();

  if (!chatId.endsWith("@g.us")) return;
  if (!["add", "remove", "promote", "demote"].includes(action)) return;
  if (!Array.isArray(update.participants) || !update.participants.length) return;

  const users = [];

  for (const raw of update.participants) {
    const user = await resolveUser(conn, raw);
    if (user.mentionJid) users.push(user);
  }

  if (!users.length) return;

  if (shouldSkip(chatId, action, users)) {
    console.log("♻️ [TEST EVENTOS] duplicado ignorado:", action, chatId);
    return;
  }

  const actor = await resolveUser(conn, {
    id: update.author || "",
    jid: update.authorPn || "",
    phoneNumber: update.authorPn || "",
    lid: update.author || ""
  });

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🧪 [TEST EVENTOS] detectado");
  console.log("➡️ Grupo:", chatId);
  console.log("➡️ Acción:", action);
  console.log("➡️ Usuarios:", users.map(u => ({ mentionJid: u.mentionJid, realJid: u.realJid, lidJid: u.lidJid, number: u.number })));
  console.log("➡️ Actor:", actor);

  const arabes = [
    "20", "212", "213", "216", "218", "222", "224", "230", "234", "235", "237", "238", "249",
    "250", "251", "252", "253", "254", "255", "257", "258", "260", "263", "269", "960", "961",
    "962", "963", "964", "965", "966", "967", "968", "970", "971", "972", "973", "974", "975",
    "976", "980", "981", "992", "994", "995", "998"
  ];

  for (const user of users) {
    if (action === "add") {
      const isArabic = user.numberTrusted && arabes.some(cc => user.number.startsWith(cc));

      if (isArabic) {
        await conn.sendMessage(chatId, {
          text: `🚫 @${user.number} detectado por antiárabe TEST. Intentando expulsar...`,
          mentions: [user.mentionJid]
        });

        try {
          await conn.groupParticipantsUpdate(chatId, [user.mentionJid], "remove");
        } catch (e) {
          console.log("❌ [TEST EVENTOS] antiárabe no pudo expulsar:", e.message);
        }

        continue;
      }

      await conn.sendMessage(chatId, {
        text: `👋 Bienvenido @${user.number}\n\n✅ TEST bienvenida funcionando.`,
        mentions: [user.mentionJid]
      });
    }

    if (action === "remove") {
      await conn.sendMessage(chatId, {
        text: `👋 Se fue @${user.number}\n\n✅ TEST despedida funcionando.`,
        mentions: [user.mentionJid]
      });
    }

    if (action === "promote") {
      await conn.sendMessage(chatId, {
        text:
`╭──『 👑 NUEVO ADMIN TEST 』─◆
│ 👤 Usuario: @${user.number}
│ ✅ Ascendido por: @${actor.number}
╰────────────────────◆`,
        mentions: [user.mentionJid, actor.mentionJid].filter(Boolean)
      });
    }

    if (action === "demote") {
      await conn.sendMessage(chatId, {
        text:
`╭──『 📉 ADMIN QUITADO TEST 』─◆
│ 👤 Usuario: @${user.number}
│ ❌ Quitado por: @${actor.number}
╰────────────────────◆`,
        mentions: [user.mentionJid, actor.mentionJid].filter(Boolean)
      });
    }
  }
}

const handler = async (conn) => {
  if (!conn?.ev?.on) {
    console.log("❌ [TEST EVENTOS] conn.ev.on no disponible.");
    return;
  }

  if (conn.__sukiGroupEventsDebugStarted) {
    console.log("♻️ [TEST EVENTOS] listener ya estaba activo.");
    return;
  }

  conn.__sukiGroupEventsDebugStarted = true;

  conn.ev.on("lid-mapping.update", async (mapping) => {
    try {
      const list = Array.isArray(mapping) ? mapping : [mapping];

      for (const item of list) {
        const lid = cleanJid(item?.lid || item?.id || "");
        const pn = cleanJid(item?.pn || item?.jid || item?.phoneNumber || "");
        rememberLidPn(lid, pn);
      }
    } catch (e) {
      console.log("⚠️ [TEST EVENTOS] error lid-mapping.update:", e.message);
    }
  });

  conn.ev.on("group-participants.update", async (update) => {
    try {
      await handleGroupEvent(conn, update);
    } catch (e) {
      console.log("❌ [TEST EVENTOS] error group-participants.update:", e.message);
    }
  });

  conn.ev.on("messages.upsert", async ({ messages }) => {
    try {
      for (const m of messages || []) {
        const update = normalizeUpdateFromStub(m || {});
        if (!update) continue;
        await handleGroupEvent(conn, update);
      }
    } catch (e) {
      console.log("❌ [TEST EVENTOS] error messages.upsert stub:", e.message);
    }
  });

  console.log("✅ [TEST EVENTOS] Plugin debug cargado: welcome/bye/promote/demote/antiarabe siempre activo.");
};

handler.run = handler;
module.exports = handler;
