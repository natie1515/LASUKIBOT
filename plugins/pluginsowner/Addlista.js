const fs = require("fs");
const path = require("path");

const handler = async (msg, { conn, args }) => {
  const chatId = msg.key.remoteJid;
  const senderId = msg.key.participant || msg.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const fromMe = msg.key.fromMe;
  const botNumber = conn.user.id.split(":")[0];
  const isBot = fromMe || senderNum === botNumber;
  const isOwner = global.isOwner(senderId);

  function onlyDigits(s) {
    return String(s || "").replace(/[^0-9]/g, "");
  }

  function isUserJid(j) {
    return typeof j === "string" && j.endsWith("@s.whatsapp.net");
  }

  function isLidJid(j) {
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
        if (isLidJid(lid)) return lid;
      }
    } catch (e) {}

    try {
      if (global.lidMap instanceof Map && global.lidMap.has(pnJid)) {
        var lid2 = global.lidMap.get(pnJid);
        if (isLidJid(lid2)) return lid2;
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
          var real = isUserJid(pid) ? pid : (isUserJid(pjid) ? pjid : null);
          var lidc = isLidJid(pid) ? pid : (isLidJid(pjid) ? pjid : null);
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
        if (isUserJid(pn)) return pn;
      }
    } catch (e) {}

    try {
      if (global.resolveRealJidAsync) {
        var pn2 = await global.resolveRealJidAsync(lidJid);
        if (isUserJid(pn2)) return pn2;
      }
    } catch (e) {}

    return null;
  }

  if (!isBot && !isOwner) {
    return conn.sendMessage(chatId, {
      text: "⛔ Este comando solo lo puede usar el *bot* o su *dueño*."
    }, { quoted: msg });
  }

  var baseNumber = args[0] ? onlyDigits(args[0]) : "";
  var zeroNumber = baseNumber ? addZero(baseNumber) : "";
  var lidNumber = "";

  var quotedParticipant = getQuotedParticipant();

  if (!baseNumber && quotedParticipant) {
    if (isLidJid(quotedParticipant)) {
      lidNumber = onlyDigits(quotedParticipant.split("@")[0].split(":")[0]);
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
    return conn.sendMessage(chatId, {
      text: "⚠️ *Debes escribir el número o responder al mensaje del usuario a agregar.*"
    }, { quoted: msg });
  }

  var porGuardar = [];
  if (baseNumber) porGuardar.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) porGuardar.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) porGuardar.push(lidNumber);

  var filePath = path.resolve("setwelcome.json");
  var data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf-8")) : {};
  data.lista = Array.isArray(data.lista) ? data.lista : [];

  var agregados = [];
  var yaExistian = [];
  var mentions = [];

  for (var k = 0; k < porGuardar.length; k++) {
    var num = porGuardar[k];
    var jid = num + "@s.whatsapp.net";
    if (data.lista.indexOf(jid) === -1) {
      data.lista.push(jid);
      agregados.push(num);
      mentions.push(jid);
    } else {
      yaExistian.push(num);
    }
  }

  if (agregados.length === 0) {
    return conn.sendMessage(chatId, {
      text: "⚠️ Todos los números ya están en la lista.\n\n" +
        "📌 Detectados:\n" +
        porGuardar.map(function(v) { return "• " + v; }).join("\n")
    }, { quoted: msg });
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  var texto = "✅ Agregado a la lista correctamente.\n\n" +
    "📌 Guardados nuevos:\n" +
    agregados.map(function(v) { return "• @" + v; }).join("\n");

  if (yaExistian.length > 0) {
    texto += "\n\nℹ️ Ya existían:\n" +
      yaExistian.map(function(v) { return "• " + v; }).join("\n");
  }

  return conn.sendMessage(chatId, {
    text: texto,
    mentions: mentions
  }, { quoted: msg });
};

handler.command = ["addlista"];
module.exports = handler;
