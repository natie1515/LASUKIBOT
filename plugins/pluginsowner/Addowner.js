const fs = require("fs");
const path = require("path");

const OWNER_PATH = path.resolve("./owner.json");
const isUser = (j = "") => typeof j === "string" && j.endsWith("@s.whatsapp.net");
const isLid = (j = "") => typeof j === "string" && j.endsWith("@lid");
const onlyDigits = (s = "") => String(s || "").replace(/D/g, "");

function withZero(num = "") {
  const clean = onlyDigits(num);
  if (!clean) return "";
  return clean.endsWith("0") ? clean : clean + "0";
}

function getCtx(msg) {
  return (
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    msg.message?.audioMessage?.contextInfo ||
    msg.message?.stickerMessage?.contextInfo ||
    null
  );
}

async function resolveLidFromPn(conn, pnJid, chatId) {
  try {
    if (conn.signalRepository?.lidMapping?.getLIDForPN) {
      const got = await conn.signalRepository.lidMapping.getLIDForPN(pnJid);
      if (isLid(got)) return got;
    }
  } catch {}

  try {
    if (global.lidMap instanceof Map && global.lidMap.has(pnJid)) {
      const got = global.lidMap.get(pnJid);
      if (isLid(got)) return got;
    }
  } catch {}

  try {
    if (String(chatId).endsWith("@g.us") && conn.groupMetadata) {
      const meta = await conn.groupMetadata(chatId);
      const participants = Array.isArray(meta?.participants) ? meta.participants : [];

      for (const p of participants) {
        const pid = typeof p?.id === "string" ? p.id : "";
        const pjid = typeof p?.jid === "string" ? p.jid : "";
        const real = isUser(pid) ? pid : (isUser(pjid) ? pjid : null);
        const lidCandidate = isLid(pid) ? pid : (isLid(pjid) ? pjid : null);
        if (real === pnJid && lidCandidate) return lidCandidate;
      }
    }
  } catch {}

  return null;
}

async function resolvePnFromLid(conn, lidJid) {
  try {
    if (conn.signalRepository?.lidMapping?.getPNForLID) {
      const got = await conn.signalRepository.lidMapping.getPNForLID(lidJid);
      if (isUser(got)) return got;
    }
  } catch {}

  try {
    if (global.resolveRealJidAsync) {
      const got = await global.resolveRealJidAsync(lidJid);
      if (isUser(got)) return got;
    }
  } catch {}

  return null;
}

async function resolveTargetVariants(conn, msg, args) {
  const chatId = msg.key.remoteJid;
  const ctx = getCtx(msg);
  const quotedParticipant = typeof ctx?.participant === "string" ? ctx.participant : "";
  const typedRaw = String(args?.[0] || "").trim();

  let baseNumber = "";
  let zeroNumber = "";
  let lidNumber = "";

  // 1) Si fue escrito manualmente
  if (typedRaw) {
    baseNumber = onlyDigits(typedRaw);
    zeroNumber = withZero(baseNumber);

    const candidates = [];
    if (baseNumber) candidates.push(`${baseNumber}@s.whatsapp.net`);
    if (zeroNumber && zeroNumber !== baseNumber) candidates.push(`${zeroNumber}@s.whatsapp.net`);

    for (const pnJid of candidates) {
      const lidJid = await resolveLidFromPn(conn, pnJid, chatId);
      if (lidJid) {
        lidNumber = onlyDigits(lidJid.split("@")[0].split(":")[0]);
        break;
      }
    }
  }

  // 2) Si fue citado
  if (!baseNumber && quotedParticipant) {
    if (isLid(quotedParticipant)) {
      lidNumber = onlyDigits(quotedParticipant.split("@")[0].split(":")[0]);
      const pnJid = await resolvePnFromLid(conn, quotedParticipant);
      if (pnJid) {
        baseNumber = onlyDigits(pnJid.split("@")[0].split(":")[0]);
        zeroNumber = withZero(baseNumber);
      }
    } else {
      baseNumber = onlyDigits(quotedParticipant.split("@")[0].split(":")[0]);
      zeroNumber = withZero(baseNumber);

      const candidates = [];
      if (baseNumber) candidates.push(`${baseNumber}@s.whatsapp.net`);
      if (zeroNumber && zeroNumber !== baseNumber) candidates.push(`${zeroNumber}@s.whatsapp.net`);

      for (const pnJid of candidates) {
        const lidJid = await resolveLidFromPn(conn, pnJid, chatId);
        if (lidJid) {
          lidNumber = onlyDigits(lidJid.split("@")[0].split(":")[0]);
          break;
        }
      }
    }
  }

  return {
    baseNumber: onlyDigits(baseNumber),
    zeroNumber: onlyDigits(zeroNumber),
    lidNumber: onlyDigits(lidNumber)
  };
}

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const sender = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const numero = onlyDigits(String(sender).split("@")[0].split(":")[0]);
  const fromMe = msg.key.fromMe;
  const botID = onlyDigits((conn.user?.id || "").split(":")[0]);

  await conn.sendMessage(chatId, {
    react: { text: "⏳", key: msg.key }
  });

  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  const { baseNumber, zeroNumber, lidNumber } = await resolveTargetVariants(conn, msg, args);

  if (!baseNumber && !zeroNumber && !lidNumber) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: "⚠️ Usa:
.addowner 507xxxxxxx o cita un mensaje.

ℹ️ El comando guardará el número escrito, su versión con 0 y el LID si está disponible."
    }, { quoted: msg });
  }

  let lista = [];
  try {
    if (!fs.existsSync(OWNER_PATH)) fs.writeFileSync(OWNER_PATH, JSON.stringify([], null, 2));
    lista = JSON.parse(fs.readFileSync(OWNER_PATH, "utf-8"));
    if (!Array.isArray(lista)) lista = [];
  } catch {
    lista = [];
  }

  const existing = new Set();
  for (const item of lista) {
    if (Array.isArray(item)) {
      for (const v of item) {
        const d = onlyDigits(v);
        if (d) existing.add(d);
      }
    } else {
      const d = onlyDigits(item);
      if (d) existing.add(d);
    }
  }

  const toSave = [];
  if (baseNumber) toSave.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) toSave.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) toSave.push(lidNumber);

  const added = [];
  for (const n of toSave) {
    if (!existing.has(n)) {
      lista.push([n]);
      existing.add(n);
      added.push(n);
    }
  }

  if (!added.length) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text:
        `⚠️ Todos los números ya estaban guardados como owner.
` +
        `➤ Base: ${baseNumber || "—"}
` +
        `➤ Con 0: ${zeroNumber || "—"}
` +
        `➤ LID: ${lidNumber || "No disponible"}`
    }, { quoted: msg });
  }

  fs.writeFileSync(OWNER_PATH, JSON.stringify(lista, null, 2));
  global.owner = lista;

  await conn.sendMessage(chatId, {
    react: { text: "✅", key: msg.key }
  });

  return conn.sendMessage(chatId, {
    text:
      `✅ Owner agregado correctamente.
` +
      `➤ Base: ${baseNumber || "—"}
` +
      `➤ Con 0: ${zeroNumber || "—"}
` +
      `➤ LID: ${lidNumber || "No disponible"}

` +
      `📌 Guardados nuevos:
${added.map(v => `• ${v}`).join("
")}`
  }, { quoted: msg });
};

handler.command = ["addowner"];
module.exports = handler;
