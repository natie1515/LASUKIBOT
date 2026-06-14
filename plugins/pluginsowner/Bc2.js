// plugins/bc2.js
import fs from 'fs';
import path from 'path';

// ——— Estado en memoria ———
const pendingBc2 = Object.create(null); // msgId -> job

// ——— Helpers ESM-safe + quoted ———
function unwrapMessage(m) {
  let n = m;
  while (
    n?.viewOnceMessage?.message ||
    n?.viewOnceMessageV2?.message ||
    n?.viewOnceMessageV2Extension?.message ||
    n?.ephemeralMessage?.message
  ) {
    n =
      n.viewOnceMessage?.message ||
      n.viewOnceMessageV2?.message ||
      n.viewOnceMessageV2Extension?.message ||
      n.ephemeralMessage?.message;
  }
  return n;
}
function collectContextInfos(msg) {
  const root = unwrapMessage(msg?.message) || {};
  const nodes = [
    root.extendedTextMessage,
    root.imageMessage,
    root.videoMessage,
    root.documentMessage,
    root.audioMessage,
    root.stickerMessage,
    root.buttonsMessage,
    root.templateMessage,
  ].filter(Boolean);
  const ctxs = [];
  for (const n of nodes) if (n.contextInfo) ctxs.push(n.contextInfo);
  return ctxs;
}
function getQuotedMessage(msg) {
  for (const c of collectContextInfos(msg)) if (c?.quotedMessage) return unwrapMessage(c.quotedMessage);
  return null;
}
function getPlainText(msg) {
  const root = unwrapMessage(msg?.message) || {};
  return (
    root.conversation ||
    root.extendedTextMessage?.text ||
    ""
  );
}
async function getDownloader(wa) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa.downloadContentFromMessage;
  try {
    const m = await import("@whiskeysockets/baileys");
    return m.downloadContentFromMessage;
  } catch {
    return null;
  }
}
async function bufFrom(DL, nodeType, node) {
  const stream = await DL(node, nodeType);
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
  return buf;
}

// ——— Listener de segunda fase (una sola vez) ———
function attachBc2Listener(conn) {
  if (conn._bc2Listener) return;
  conn._bc2Listener = true;

  conn.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) {
      try {
        // buscar si cita a un listado activo
        const ctxs = collectContextInfos(m);
        let listedMsgId = null;
        for (const c of ctxs) {
          if (c?.stanzaId && pendingBc2[c.stanzaId]) { listedMsgId = c.stanzaId; break; }
        }
        if (!listedMsgId) continue;

        const job = pendingBc2[listedMsgId];
        // expirar jobs viejos
        if (!job || (job.expires && Date.now() > job.expires)) { delete pendingBc2[listedMsgId]; continue; }

        const text = getPlainText(m).trim();
        if (!text) continue;

        try { await conn.sendMessage(job.chatId, { react: { text: "🚀", key: m.key } }); } catch {}

        // “1 3 5” -> [0,2,4]
        const picks = [...new Set(
          text.split(/\s+/).map(n => parseInt(n, 10) - 1).filter(i => i >= 0 && i < job.groupIds.length)
        )];

        if (!picks.length) {
          await conn.sendMessage(job.chatId,
            { text: "❌ Selección inválida. Escribe los números separados por espacios." },
            { quoted: m }
          );
          continue;
        }

        for (const idx of picks) {
          const gid = job.groupIds[idx];
          try { await conn.sendMessage(gid, job.broadcastMsg); }
          catch (e) { console.error("Error enviando bc2 a", gid, e); }
          await new Promise(r => setTimeout(r, 1000)); // anti rate-limit
        }

        delete pendingBc2[listedMsgId];
        await conn.sendMessage(job.chatId,
          { text: `✅ Broadcast enviado a ${picks.length} grupo(s).` },
          { quoted: job.commandMsg }
        );
      } catch (e) {
        console.error("🛑 Error en bc2 listener:", e);
      }
    }
  });
}

// ——— Handler principal ———
const handler = async (msg, { conn, wa }) => {
  const chatId   = msg.key.remoteJid;
  const senderId = (msg.key.participant || chatId).replace(/\D/g, "");

  // Permiso: Owner o fromMe
  const ownersPath = path.resolve("owner.json");
  const owners = fs.existsSync(ownersPath) ? JSON.parse(fs.readFileSync(ownersPath, "utf-8")) : [];
  const isOwner = Array.isArray(owners) && owners.some(([id]) => id === senderId);
  if (!isOwner && !msg.key.fromMe) {
    return conn.sendMessage(chatId, { text: "⚠️ Solo el *Owner* puede usar este comando." }, { quoted: msg });
  }

  const cited = getQuotedMessage(msg);
  if (!cited) {
    return conn.sendMessage(chatId, { text: "⚠️ Cita un mensaje para preparar el *bc2*." }, { quoted: msg });
  }

  const DL = await getDownloader(wa);
  if (!DL) {
    return conn.sendMessage(chatId, { text: "❌ Falta downloader de Baileys (wa.downloadContentFromMessage)." }, { quoted: msg });
  }

  // Header del broadcast
  const fecha  = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  const header = `📢 *COMUNICADO OFICIAL DE SUKI BOT* 📢\n──────────────\n🕒 Fecha: ${fecha}\n──────────────\n\n`;

  // Construir broadcastMsg (soporta texto/imagen/video/audio/sticker/document)
  let broadcastMsg = null;
  if (cited.conversation) {
    broadcastMsg = { text: header + cited.conversation };
  } else if (cited.extendedTextMessage?.text) {
    broadcastMsg = { text: header + cited.extendedTextMessage.text };
  } else if (cited.imageMessage) {
    const buf = await bufFrom(DL, "image", cited.imageMessage);
    broadcastMsg = { image: buf, caption: header + (cited.imageMessage.caption || "") };
  } else if (cited.videoMessage) {
    const buf = await bufFrom(DL, "video", cited.videoMessage);
    broadcastMsg = {
      video: buf,
      caption: header + (cited.videoMessage.caption || ""),
      gifPlayback: !!cited.videoMessage.gifPlayback
    };
  } else if (cited.audioMessage) {
    const buf = await bufFrom(DL, "audio", cited.audioMessage);
    await conn.sendMessage(chatId, { text: header }, { quoted: msg });
    broadcastMsg = { audio: buf, mimetype: cited.audioMessage.mimetype || "audio/mpeg" };
  } else if (cited.stickerMessage) {
    const buf = await bufFrom(DL, "sticker", cited.stickerMessage);
    await conn.sendMessage(chatId, { text: header }, { quoted: msg });
    broadcastMsg = { sticker: buf };
  } else if (cited.documentMessage) {
    const buf = await bufFrom(DL, "document", cited.documentMessage);
    broadcastMsg = {
      document: buf,
      fileName: cited.documentMessage.fileName || "archivo",
      mimetype: cited.documentMessage.mimetype || "application/octet-stream",
      caption: header + (cited.documentMessage.caption || "")
    };
  } else {
    return conn.sendMessage(chatId, { text: "❌ Tipo de mensaje no soportado para bc2." }, { quoted: msg });
  }

  // Obtener lista de grupos
  let groups;
  try { groups = await conn.groupFetchAllParticipating(); }
  catch { return conn.sendMessage(chatId, { text: "❌ Error al obtener la lista de grupos." }, { quoted: msg }); }

  const groupIds = Object.keys(groups);
  if (!groupIds.length) {
    return conn.sendMessage(chatId, { text: "❌ No estoy en ningún grupo." }, { quoted: msg });
  }

  // Enviar listado numerado
  const listado = groupIds.map((id, i) => `${i + 1}. ${groups[id].subject || id}`).join("\n");
  const preview = await conn.sendMessage(
    chatId,
    { text: `📋 *Elige a qué grupos enviar:*\n${listado}\n\n✍️ Cita este mensaje y responde con los números (ej: 1 3 5).` },
    { quoted: msg }
  );

  // Guardar estado y activar listener
  pendingBc2[preview.key.id] = {
    chatId,
    groupIds,
    broadcastMsg,
    commandMsg: msg,
    expires: Date.now() + 5 * 60 * 1000 // 5 min TTL
  };
  attachBc2Listener(conn);
};

handler.command = ["bc2"];

export default handler;
