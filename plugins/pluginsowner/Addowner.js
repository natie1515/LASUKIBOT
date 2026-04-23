const fs = require("fs");
const path = require("path");

const handler = async (msg, { conn, args }) => {
  const sender = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const numero = String(sender).split("@")[0].split(":")[0].replace(/D/g, "");
  const fromMe = msg.key.fromMe;
  const botID = String(conn.user?.id || "").split(":")[0].replace(/D/g, "");
  const chatId = msg.key.remoteJid;

  const onlyDigits = (s = "") => String(s || "").replace(/D/g, "");
  const isUser = (j = "") => typeof j === "string" && j.endsWith("@s.whatsapp.net");
  const isLid = (j = "") => typeof j === "string" && j.endsWith("@lid");
  const addZero = (n = "") => {
    const clean = onlyDigits(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  };

  const getContextInfo = () => {
    return (
      msg.message?.extendedTextMessage?.contextInfo ||
      msg.message?.imageMessage?.contextInfo ||
      msg.message?.videoMessage?.contextInfo ||
      msg.message?.documentMessage?.contextInfo ||
      msg.message?.audioMessage?.contextInfo ||
      msg.message?.stickerMessage?.contextInfo ||
      null
    );
  };

  const getQuotedParticipant = () => {
    const ctx = getContextInfo();
    return typeof ctx?.participant === "string" ? ctx.participant : "";
  };

  const resolveLidFromPn = async (pnJid) => {
    try {
      if (conn.signalRepository?.lidMapping?.getLIDForPN) {
        const lid = await conn.signalRepository.lidMapping.getLIDForPN(pnJid);
        if (isLid(lid)) return lid;
      }
    } catch {}

    try {
      if (global.lidMap instanceof Map && global.lidMap.has(pnJid)) {
        const lid = global.lidMap.get(pnJid);
        if (isLid(lid)) return lid;
      }
    } catch {}

    try {
      if (chatId.endsWith("@g.us") && conn.groupMetadata) {
        const meta = await conn.groupMetadata(chatId);
        const participants = Array.isArray(meta?.participants) ? meta.participants : [];

        for (const p of participants) {
          const pid = typeof p?.id === "string" ? p.id : "";
          const pjid = typeof p?.jid === "string" ? p.jid : "";
          const real = isUser(pid) ? pid : (isUser(pjid) ? pjid : null);
          const lid = isLid(pid) ? pid : (isLid(pjid) ? pjid : null);

          if (real === pnJid && lid) return lid;
        }
      }
    } catch {}

    return null;
  };

  const resolvePnFromLid = async (lidJid) => {
    try {
      if (conn.signalRepository?.lidMapping?.getPNForLID) {
        const pn = await conn.signalRepository.lidMapping.getPNForLID(lidJid);
        if (isUser(pn)) return pn;
      }
    } catch {}

    try {
      if (global.resolveRealJidAsync) {
        const pn = await global.resolveRealJidAsync(lidJid);
        if (isUser(pn)) return pn;
      }
    } catch {}

    return null;
  };

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

  let baseNumber = args[0] ? onlyDigits(args[0]) : "";
  let zeroNumber = baseNumber ? addZero(baseNumber) : "";
  let lidNumber = "";

  const quotedParticipant = getQuotedParticipant();

  if (!baseNumber && quotedParticipant) {
    if (isLid(quotedParticipant)) {
      lidNumber = onlyDigits(quotedParticipant.split("@")[0].split(":")[0]);

      const pn = await resolvePnFromLid(quotedParticipant);
      if (pn) {
        baseNumber = onlyDigits(pn.split("@")[0].split(":")[0]);
        zeroNumber = addZero(baseNumber);
      }
    } else {
      baseNumber = onlyDigits(quotedParticipant.split("@")[0].split(":")[0]);
      zeroNumber = addZero(baseNumber);
    }
  }

  if (!lidNumber && baseNumber) {
    const tryJids = [];
    if (baseNumber) tryJids.push(`${baseNumber}@s.whatsapp.net`);
    if (zeroNumber && zeroNumber !== baseNumber) tryJids.push(`${zeroNumber}@s.whatsapp.net`);

    for (const jid of tryJids) {
      const lid = await resolveLidFromPn(jid);
      if (lid) {
        lidNumber = onlyDigits(lid.split("@")[0].split(":")[0]);
        break;
      }
    }
  }

  if (!baseNumber && !zeroNumber && !lidNumber) {
    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });
    return conn.sendMessage(chatId, {
      text: `⚠️ Usa:
.addowner 507xxxxxxx o cita un mensaje.

ℹ️ Guardará el número base, la versión con 0 y el LID si está disponible.`
    }, { quoted: msg });
  }

  const ruta = "./owner.json";
  let lista = [];

  try {
    if (!fs.existsSync(ruta)) {
      fs.writeFileSync(ruta, JSON.stringify([], null, 2));
    }
    lista = JSON.parse(fs.readFileSync(ruta, "utf-8"));
    if (!Array.isArray(lista)) lista = [];
  } catch {
    lista = [];
  }

  const existentes = new Set();
  for (const item of lista) {
    if (Array.isArray(item)) {
      for (const v of item) {
        const d = onlyDigits(v);
        if (d) existentes.add(d);
      }
    } else {
      const d = onlyDigits(item);
      if (d) existentes.add(d);
    }
  }

  const porGuardar = [];
  if (baseNumber) porGuardar.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) porGuardar.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) porGuardar.push(lidNumber);

  const agregados = [];
  for (const n of porGuardar) {
    if (!existentes.has(n)) {
      lista.push([n]);
      existentes.add(n);
      agregados.push(n);
    }
  }

  if (!agregados.length) {
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

  fs.writeFileSync(ruta, JSON.stringify(lista, null, 2));
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
${agregados.map(v => `• ${v}`).join("
")}`
  }, { quoted: msg });
};

handler.command = ["addowner"];
module.exports = handler;
