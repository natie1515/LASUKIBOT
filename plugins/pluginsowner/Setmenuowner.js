// plugins/setmenuowner.js
import fs from 'fs';
import path from 'path';

const DIGITS = (s = "") => String(s).replace(/\D/g, "");

function isOwnerByNumber(num) {
  if (typeof global.isOwner === "function") return global.isOwner(num);
  return Array.isArray(global.owner) && global.owner.some(([id]) => id === num);
}

/** Desencapsula viewOnce/ephemeral y retorna el nodo interno */
function unwrapMessage(m) {
  let node = m;
  while (
    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message
  ) {
    node =
      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;
  }
  return node;
}

/** Texto del citado (preserva saltos/espacios) */
function getQuotedText(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.conversation || inner?.extendedTextMessage?.text || null;
}

/** Imagen del citado (soporta viewOnce/ephemeral) */
function getQuotedImageMessage(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  const inner = unwrapMessage(q);
  return inner?.imageMessage || null;
}

/** Obtiene wa.downloadContentFromMessage desde donde esté inyectado */
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, args, text, wa }) => {
  const chatId    = msg.key.remoteJid;
  const senderJid = msg.key.participant || msg.key.remoteJid;
  const senderNum = DIGITS(senderJid);
  const fromMe    = !!msg.key.fromMe;

  // 🔐 Permisos: solo owners o el mismo bot
  const botNum = DIGITS(conn.user?.id || "");
  const owner  = isOwnerByNumber(senderNum);
  if (!owner && !fromMe && senderNum !== botNum) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: "🚫 Este comando solo puede usarlo un *Owner* o el *bot*.",
    }, { quoted: msg });
  }

  // ✏️ Texto crudo (no recortar; quita solo un espacio inicial si viene)
  const textoArg  = typeof text === "string" ? text : (Array.isArray(args) ? args.join(" ") : "");
  const textoUser = textoArg.startsWith(" ") ? textoArg.slice(1) : textoArg;

  // Extraer posibles contenidos del citado
  const quotedText  = !textoUser ? getQuotedText(msg) : null;
  const quotedImage = getQuotedImageMessage(msg);

  if (!textoUser && !quotedText && !quotedImage) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: "✏️ Usa: *setmenuowner <texto>* (multilínea permitido)\nO responde a una *imagen* con: *setmenuowner <texto>*",
    }, { quoted: msg });
  }

  // Descargar imagen si fue citada
  let imagenBase64 = null;
  if (quotedImage) {
    try {
      const WA = ensureWA(wa, conn);
      if (!WA) throw new Error("downloadContentFromMessage no disponible");
      const stream = await WA.downloadContentFromMessage(quotedImage, "image");
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length) imagenBase64 = buffer.toString("base64");
    } catch (e) {
      console.error("[setmenuowner] error leyendo imagen citada:", e);
    }
  }

  const textoFinal = (textoUser || quotedText || "");

  // 💾 Guardar en setmenu.json (global)
  const filePath = path.resolve("./setmenu.json");
  let data = {};
  try { data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {}; } catch {}

  // Si no envían texto esta vez, mantiene el anterior
  data.texto_owner = textoFinal || data.texto_owner || "";
  // Solo sobrescribe imagen si vino una nueva
  if (imagenBase64 !== null) data.imagen_owner = imagenBase64;

  data.updatedAt_owner = Date.now();

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  return conn.sendMessage(chatId, { text: "✅ *C-Menu Owner* actualizado globalmente." }, { quoted: msg });
};

handler.command = ["setmenuowner"];
handler.tags = ["menu"];
handler.help = ["setmenuowner <texto> (o respondiendo a imagen)"];
export default handler;
