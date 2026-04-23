const DIGITS = (s = '') => String(s || '').replace(/D/g, '');
const isUser = (j) => typeof j === 'string' && j.endsWith('@s.whatsapp.net');
const isLid = (j) => typeof j === 'string' && j.endsWith('@lid');

function getQuotedKey(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const q = msg.quoted;
  return (
    q?.key?.participant ||
    q?.key?.jid ||
    (typeof ctx?.participant === 'string' ? ctx.participant : null) ||
    null
  );
}

async function resolvePair(conn, chatId, anyJid) {
  let realJid = null;
  let lidJid = null;

  if (!anyJid || typeof anyJid !== 'string') return { realJid, lidJid };

  if (isUser(anyJid)) realJid = anyJid;
  if (isLid(anyJid)) lidJid = anyJid;

  // 1) Intentar con mapping de Baileys
  try {
    if (!realJid && lidJid && conn.signalRepository?.lidMapping?.getPNForLID) {
      const pn = await conn.signalRepository.lidMapping.getPNForLID(lidJid);
      if (isUser(pn)) realJid = pn;
    }

    if (!lidJid && realJid && conn.signalRepository?.lidMapping?.getLIDForPN) {
      const lid = await conn.signalRepository.lidMapping.getLIDForPN(realJid);
      if (isLid(lid)) lidJid = lid;
    }
  } catch {}

  // 2) Intentar con metadata del grupo
  try {
    const metadata = await conn.groupMetadata(chatId);
    const participantes = Array.isArray(metadata?.participants) ? metadata.participants : [];

    for (const p of participantes) {
      const pid = typeof p?.id === 'string' ? p.id : '';
      const pjid = typeof p?.jid === 'string' ? p.jid : '';

      const candidateReal = isUser(pid) ? pid : (isUser(pjid) ? pjid : null);
      const candidateLid = isLid(pid) ? pid : (isLid(pjid) ? pjid : null);

      const match =
        anyJid === pid ||
        anyJid === pjid ||
        (realJid && (realJid === pid || realJid === pjid || realJid === candidateReal)) ||
        (lidJid && (lidJid === pid || lidJid === pjid || lidJid === candidateLid));

      if (match) {
        if (!realJid && candidateReal) realJid = candidateReal;
        if (!lidJid && candidateLid) lidJid = candidateLid;
        if (realJid && lidJid) break;
      }
    }
  } catch {}

  // 3) Respaldo con tus helpers globales
  if (!realJid && lidJid && global.resolveRealJidAsync) {
    try {
      const pn = await global.resolveRealJidAsync(lidJid);
      if (isUser(pn)) realJid = pn;
    } catch {}
  }

  if (!lidJid && realJid && global.lidMap instanceof Map) {
    const maybeLid = global.lidMap.get(realJid);
    if (isLid(maybeLid)) lidJid = maybeLid;
  }

  return { realJid, lidJid };
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');

  if (!isGroup) {
    return await conn.sendMessage(chatId, {
      text: '❌ Este comando solo puede usarse en grupos.'
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, {
      react: { text: '🔍', key: msg.key }
    });

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
      return await conn.sendMessage(chatId, {
        text: '❌ No pude identificar al usuario objetivo.'
      }, { quoted: msg });
    }

    const { realJid, lidJid } = await resolvePair(conn, chatId, targetKey);

    if (!realJid && !lidJid) {
      return await conn.sendMessage(chatId, {
        text: '❌ No pude resolver ni el número real ni el LID del usuario.'
      }, { quoted: msg });
    }

    const numeroReal = realJid ? `+${DIGITS(realJid)}` : '—';
    const numeroLid = lidJid ? DIGITS(lidJid) : '—';
    const estado = realJid && lidJid
      ? 'PN y LID detectados'
      : realJid
        ? 'Solo PN detectado'
        : 'Solo LID detectado';

    const texto = [
      '📡 *Datos del usuario*',
      `• Estado: ${estado}`,
      `• Número real: ${numeroReal}`,
      `• Número LID: ${numeroLid}`,
      `• JID real: `${realJid || '—'}``,
      `• JID LID: `${lidJid || '—'}``
    ].join('
');

    await conn.sendMessage(chatId, {
      text: texto,
      mentions: realJid ? [realJid] : []
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: '✅', key: msg.key }
    });
  } catch (err) {
    console.error('❌ Error en mylid:', err);
    await conn.sendMessage(chatId, {
      text: '❌ Ocurrió un error al obtener la información del usuario.'
    }, { quoted: msg });
  }
};

handler.command = ['mylid'];
module.exports = handler;
