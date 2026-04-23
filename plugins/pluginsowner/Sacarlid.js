const fs = require("fs");

const handler = async (msg, { conn, args }) => {
  const sender = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const numero = String(sender).split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
  const fromMe = msg.key.fromMe;
  const botID = String(conn.user && conn.user.id ? conn.user.id : "").split(":")[0].replace(/[^0-9]/g, "");
  const chatId = msg.key.remoteJid;

  function onlyDigits(s) {
    return String(s || "").replace(/[^0-9]/g, "");
  }

  function isUser(j) {
    return typeof j === "string" && j.endsWith("@s.whatsapp.net");
  }

  function isLid(j) {
    return typeof j === "string" && j.endsWith("@lid");
  }

  function addZero(n) {
    var clean = onlyDigits(n);
    if (!clean) return "";
    return clean.endsWith("0") ? clean : clean + "0";
  }

  function getContextInfo() {
    var mm = msg.message || {};
    return (
      (mm.extendedTextMessage && mm.extendedTextMessage.contextInfo) ||
      (mm.imageMessage && mm.imageMessage.contextInfo) ||
      (mm.videoMessage && mm.videoMessage.contextInfo) ||
      (mm.documentMessage && mm.documentMessage.contextInfo) ||
      (mm.audioMessage && mm.audioMessage.contextInfo) ||
      (mm.stickerMessage && mm.stickerMessage.contextInfo) ||
      null
    );
  }

  function getQuotedParticipant() {
    var ctx = getContextInfo();
    return ctx && typeof ctx.participant === "string" ? ctx.participant : "";
  }

  async function resolveLidFromPn(pnJid) {
    try {
      if (conn.signalRepository && conn.signalRepository.lidMapping && conn.signalRepository.lidMapping.getLIDForPN) {
        var lid = await conn.signalRepository.lidMapping.getLIDForPN(pnJid);
        if (isLid(lid)) return lid;
      }
    } catch (e) {}

    try {
      if (global.lidMap instanceof Map && global.lidMap.has(pnJid)) {
        var lid2 = global.lidMap.get(pnJid);
        if (isLid(lid2)) return lid2;
      }
    } catch (e) {}

    try {
      if (chatId.endsWith("@g.us") && conn.groupMetadata) {
        var meta = await conn.groupMetadata(chatId);
        var participants = Array.isArray(meta && meta.participants) ? meta.participants : [];

        for (var i = 0; i < participants.length; i++) {
          var p = participants[i];
          var pid = typeof p.id === "string" ? p.id : "";
          var pjid = typeof p.jid === "string" ? p.jid : "";
          var real = isUser(pid) ? pid : (isUser(pjid) ? pjid : null);
          var lidc = isLid(pid) ? pid : (isLid(pjid) ? pjid : null);
          if (real === pnJid && lidc) return lidc;
        }
      }
    } catch (e) {}

    return null;
  }

  async function resolvePnFromLid(lidJid) {
    try {
      if (conn.signalRepository && conn.signalRepository.lidMapping && conn.signalRepository.lidMapping.getPNForLID) {
        var pn = await conn.signalRepository.lidMapping.getPNForLID(lidJid);
        if (isUser(pn)) return pn;
      }
    } catch (e) {}

    try {
      if (global.resolveRealJidAsync) {
        var pn2 = await global.resolveRealJidAsync(lidJid);
        if (isUser(pn2)) return pn2;
      }
    } catch (e) {}

    return null;
  }

  await conn.sendMessage(chatId, { react: { text: "🔍", key: msg.key } });

  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
    }, { quoted: msg });
  }

  var baseNumber = args[0] ? onlyDigits(args[0]) : "";
  var zeroNumber = baseNumber ? addZero(baseNumber) : "";
  var lidNumber = "";
  var fueResueltoDesdeLid = false;

  var quotedParticipant = getQuotedParticipant();

  if (!baseNumber && quotedParticipant) {
    if (isLid(quotedParticipant)) {
      lidNumber = onlyDigits(quotedParticipant.split("@")[0].split(":")[0]);
      fueResueltoDesdeLid = true;
      var pnResolved = await resolvePnFromLid(quotedParticipant);
      if (pnResolved) {
        baseNumber = onlyDigits(pnResolved.split("@")[0].split(":")[0]);
        zeroNumber = addZero(baseNumber);
      }
    } else {
      baseNumber = onlyDigits(quotedParticipant.split("@")[0].split(":")[0]);
      zeroNumber = addZero(baseNumber);
    }
  }

  if (!lidNumber && baseNumber) {
    var tryJids = [];
    if (baseNumber) tryJids.push(baseNumber + "@s.whatsapp.net");
    if (zeroNumber && zeroNumber !== baseNumber) tryJids.push(zeroNumber + "@s.whatsapp.net");

    for (var j = 0; j < tryJids.length; j++) {
      var foundLid = await resolveLidFromPn(tryJids[j]);
      if (foundLid) {
        lidNumber = onlyDigits(foundLid.split("@")[0].split(":")[0]);
        break;
      }
    }
  }

  if (!baseNumber && !zeroNumber && !lidNumber) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "⚠️ Usa:.sacarlid 507xxxxxxx o cita el mensaje del usuario.El comando resolvera su numero real y su LID."
    }, { quoted: msg });
  }

  var estadoTexto = "";
  if (baseNumber && lidNumber) {
    estadoTexto = "✅ PN y LID detectados";
  } else if (baseNumber && !lidNumber) {
    estadoTexto = "🟡 Solo numero real (LID no disponible)";
  } else if (!baseNumber && lidNumber) {
    estadoTexto = "🔵 Solo LID (numero real no disponible)";
  }

  var respuesta = "📡 Datos del usuario\n\n" +
    "• Estado: " + estadoTexto + "\n" +
    "• Numero base: " + (baseNumber || "—") + "\n" +
    "• Numero con 0: " + (zeroNumber || "—") + "\n" +
    "• Numero LID: " + (lidNumber || "No disponible") + "\n\n" +
    "🔗 JID real: " + (baseNumber ? baseNumber + "@s.whatsapp.net" : "—") + "\n" +
    "🧬 JID LID: " + (lidNumber ? lidNumber + "@lid" : "—");

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  return conn.sendMessage(chatId, {
    text: respuesta
  }, { quoted: msg });
};

handler.command = ["sacarlid"];
module.exports = handler;
