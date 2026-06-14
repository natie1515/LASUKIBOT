// plugins/setmenu.js
import fs from 'fs';
import path from 'path';

/** Extrae texto del mensaje citado (conserva saltos y espacios) */
function getQuotedText(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!q) return null;
  return (
    q.conversation ||
    q?.extendedTextMessage?.text ||
    q?.ephemeralMessage?.message?.conversation ||
    q?.ephemeralMessage?.message?.extendedTextMessage?.text ||
    q?.viewOnceMessageV2?.message?.conversation ||
    q?.viewOnceMessageV2?.message?.extendedTextMessage?.text ||
    q?.viewOnceMessageV2Extension?.message?.conversation ||
    q?.viewOnceMessageV2Extension?.message?.extendedTextMessage?.text ||
    null
  );
}

/** Desencapsula viewOnce/ephemeral para acceder al mensaje real */
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

/** Asegura acceso a wa.downloadContentFromMessage */
function ensureWA(wa, conn) {
  if (wa && typeof wa.downloadContentFromMessage === "function") return wa;
  if (conn && conn.wa && typeof conn.wa.downloadContentFromMessage === "function") return conn.wa;
  if (global.wa && typeof global.wa.downloadContentFromMessage === "function") return global.wa;
  return null;
}

const handler = async (msg, { conn, args, text, wa }) => {
  const chatId   = msg.key.remoteJid;
  const senderId = msg.key.participant || msg.key.remoteJid;
  const numero   = (senderId || "").replace(/[^0-9]/g, "");
  const fromMe   = !!msg.key.fromMe;
  const botID    = (conn.user?.id || "").replace(/[^0-9]/g, "");

  // 🔐 Permisos globales (igual estilo que addowner)
  if (!(typeof global.isOwner === "function" ? global.isOwner(numero) : false) && !fromMe && numero !== botID) {
    try { await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } }); } catch {}
    return conn.sendMessage(chatId, {
      text: "🚫 Este comando solo puede usarlo un *Owner* o el *mismo bot*."
    }, { quoted: msg });
  }

  // ——— Texto crudo (NO trim agresivo) ———
  const textoArg  = typeof text === "string" ? text : (Array.isArray(args) ? args.join(" ") : "");
  const textoCrudo = textoArg.startsWith(" ") ? textoArg.slice(1) : textoArg;

  // Texto de respuesta citado (si no se escribió nada tras el comando)
  const quotedText = !textoCrudo ? getQuotedText(msg) : null;

  // Imagen citada (desencapsulada)
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const qRaw = ctx?.quotedMessage;
  const inner = qRaw ? unwrapMessage(qRaw) : null;
  const quotedImage = inner?.imageMessage;

  if (!textoCrudo && !quotedText && !quotedImage) {
    return conn.sendMessage(chatId, {
      text: `✏️ *Uso:*\n• .setmenu <texto>  (admite multilínea si respondes a un mensaje de texto)\n• O *responde a una imagen* y escribe: .setmenu <texto opcional>`
    }, { quoted: msg });
  }

  // Asegurar WA para descargar medios
  const WA = ensureWA(wa, conn);

  // Cargar JSON existente para conservar imagen previa si no envías nueva
  const filePath = path.resolve("./setmenu.json");
  let data = {};
  if (fs.existsSync(filePath)) {
    try { data = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch {}
  }

  // Descargar imagen si fue citada
  let imagenBase64 = null;
  if (quotedImage && WA) {
    try {
      const stream = await WA.downloadContentFromMessage(quotedImage, "image");
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length) imagenBase64 = buffer.toString("base64");
    } catch (e) {
      console.error("[setmenu] error leyendo imagen citada:", e);
    }
  }

  const textoFinal = (textoCrudo || quotedText || "");

  // Guardar (conserva imagen previa si no hay nueva)
  data.texto     = textoFinal;                       // conserva saltos/espacios
  data.imagen    = imagenBase64 ?? data.imagen ?? null;
  data.updatedAt = Date.now();

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  try { await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } }); } catch {}
  return conn.sendMessage(chatId, {
    text: `✅ *MENÚ global actualizado.*\n${
      textoFinal ? "• Texto: guardado" : "• Texto: (vacío)"
    }\n${
      (imagenBase64 ?? data.imagen) ? "• Imagen: guardada" : "• Imagen: (no enviada)"
    }`
  }, { quoted: msg });
};

handler.command = ["setmenu"];
export default handler;
