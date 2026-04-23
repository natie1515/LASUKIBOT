// plugins/lidsu.js
// Muestra PN real y LID del citado, mencionado o autor

const DIGITS = (s = "") => String(s || "").replace(/D/g, "");
const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
const isLid = (j) => typeof j === "string" && j.endsWith("@lid");

function getQuotedKey(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const q = msg.quoted;
  return (
    q?.key?.participant ||
    q?.key?.jid ||
    (typeof ctx?.participant === "string" ? ctx.participant : null) ||
    null
  );
}

async function resolvePair(conn, chatId, anyJid) {
  let realJid = null;
  let lidJid = null;

  if (!anyJid || typeof anyJid !== "string") {
    return { realJid, lidJid };
  }

  if (isUser(anyJid)) realJid = anyJid;
  if (isLid(anyJid)) lidJid = anyJid;

  // 1) Intentar con signalRepository (Baileys v7)
  try {
    if (conn.signalRepository?.lidMapping) {
      if (!realJid && lidJid && conn.signalRepository.lidMapping.getPNForLID) {
        const pn = await conn.signalRepository.lidMapping.getPNForLID(lidJid);
        if (isUser(pn)) realJid = pn;
      }

      if (!lidJid && realJid && conn.signalRepository.lidMapping.getLIDForPN) {
        const lid = await conn.signalRepository.lidMapping.getLIDForPN(realJid);
        if (isLid(lid)) lidJid = lid;
      }
    }
  } catch {}

  // 2) Intentar con metadata del grupo
  if (String(chatId).endsWith("@g.us")) {
    try {
      const meta = await conn.groupMetadata(chatId);
      const raw = Array.isArray(meta?.participants) ? meta.participants : [];

      for (const p of raw) {
        const pid = typeof p?.id === "string" ? p.id : null;
        const pjid = typeof p?.jid === "string" ? p.jid : null;

        const candidateReal = isUser(pjid) ? pjid : (isUser(pid) ? pid : null);
        const candidateLid = isLid(pid) ? pid : (isLid(pjid) ? pjid : null);

        const matches =
          anyJid === pid ||
          anyJid === pjid ||
          (realJid && (realJid === candidateReal || realJid === pid || realJid === pjid)) ||
          (lidJid && (lidJid === candidateLid || lidJid === pid || lidJid === pjid));

        if (matches) {
          if (!realJid && candidateReal) realJid = candidateReal;
          if (!lidJid && candidateLid) lidJid = candidateLid;
          if (realJid && lidJid) break;
        }
      }
    } catch {}
  }

  // 3) Respaldo con tus helpers globales
  if (!realJid && lidJid && global.resolveRealJidAsync) {
    try {
      const pn = await global.resolveRealJidAsync(lidJid);
      if (isUser(pn)) realJid = pn;
    } catch {}
  }

  if (!lidJid && realJid && global.lidMap instanceof Map && global.lidMap.has(realJid)) {
    const maybeLid = global.lidMap.get(realJid);
    if (isLid(maybeLid)) lidJid = maybeLid;
  }

  // 4) Fallback final
  if (!realJid && isUser(anyJid)) realJid = anyJid;
  if (!lidJid && isLid(anyJid)) lidJid = anyJid;

  return { realJid, lidJid };
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;

  try {
    await conn.sendMessage(chatId, { react: { text: "🔎", key: msg.key } });
  } catch {}

  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    null;

  const mentioned = Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : [];
  const quotedKey = getQuotedKey(msg);

  const targetKey =
    quotedKey ||
    mentioned[0] ||
    msg.realJid ||
    msg.realLid ||
    msg.key.participant ||
    msg.key.remoteJid;

  if (!targetKey) {
    return conn.sendMessage(chatId, {
      text: "❌ No pude identificar al usuario objetivo."
    }, { quoted: msg });
  }

  try {
    const { realJid, lidJid } = await resolvePair(conn, chatId, targetKey);

    if (!realJid && !lidJid) {
      return conn.sendMessage(chatId, {
        text: "❌ No pude resolver ni el número real ni el LID del usuario."
      }, { quoted: msg });
    }

    const numeroReal = realJid ? `+${DIGITS(realJid)}` : "—";
    const numeroLid = lidJid ? DIGITS(lidJid) : "—";

    const estado = realJid && lidJid
      ? "PN y LID detectados"
      : realJid
        ? "Solo PN detectado"
        : "Solo LID detectado";

    const texto =
`📡 *Datos del usuario*
• Estado: ${estado}
• Número real: ${numeroReal}
• Número LID: ${numeroLid}
• JID real: `${realJid || "—"}`
• JID LID: `${lidJid || "—"}``;

    const mentions = realJid ? [realJid] : [];
    await conn.sendMessage(chatId, { text: texto, mentions }, { quoted: msg });

    try {
      await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
    } catch {}
  } catch (e) {
    console.error("[lidsu] error:", e);
    await conn.sendMessage(chatId, {
      text: "❌ Ocurrió un error al resolver los datos."
    }, { quoted: msg });
  }
};

handler.command = ["mylid"];
module.exports = handler;
