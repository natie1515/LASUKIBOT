import fs from 'fs';

const handler = async (msg, { conn, args }) => {
  const sender = msg.realJid || msg.key.participant || msg.key.remoteJid;
  const numero = String(sender).split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
  const fromMe = msg.key.fromMe;
  const botID = String(conn.user && conn.user.id ? conn.user.id : "").split(":")[0].replace(/[^0-9]/g, "");
  const chatId = msg.key.remoteJid;

  const PROTECTED = ["15167096032"];

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

  await conn.sendMessage(chatId, { react: { text: "⏳", key: msg.key } });

  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "🚫 Solo los owners pueden usar este comando."
    }, { quoted: msg });
  }

  var baseNumber = args[0] ? onlyDigits(args[0]) : "";
  var zeroNumber = baseNumber ? addZero(baseNumber) : "";
  var lidNumber = "";

  var quotedParticipant = getQuotedParticipant();

  if (!baseNumber && quotedParticipant) {
    if (isLid(quotedParticipant)) {
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
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "⚠️ Usa:.delowner 507xxxxxxx o cita el mensaje del usuario."
    }, { quoted: msg });
  }

  var candidatos = [];
  if (baseNumber) candidatos.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) candidatos.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) candidatos.push(lidNumber);

  var bloqueado = candidatos.filter(function(n) {
    return PROTECTED.indexOf(n) !== -1;
  });

  if (bloqueado.length > 0) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "⚠️ No se puede eliminar el owner principal."
    }, { quoted: msg });
  }

  var ruta = "./owner.json";
  var lista = [];

  try {
    if (!fs.existsSync(ruta)) {
      fs.writeFileSync(ruta, JSON.stringify([], null, 2));
    }
    lista = JSON.parse(fs.readFileSync(ruta, "utf-8"));
    if (!Array.isArray(lista)) lista = [];
  } catch (e) {
    lista = [];
  }

  var candidatosSet = {};
  for (var c = 0; c < candidatos.length; c++) {
    candidatosSet[candidatos[c]] = true;
  }

  var eliminados = [];
  var nuevaLista = lista.filter(function(item) {
    var n = Array.isArray(item) ? onlyDigits(item[0]) : onlyDigits(item);
    if (n && candidatosSet[n]) {
      eliminados.push(n);
      return false;
    }
    return true;
  });

  if (eliminados.length === 0) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "⚠️ Ninguno de esos numeros estaba guardado como owner.\n\n" +
        "📌 Buscados:\n" +
        candidatos.map(function(v) { return "• " + v; }).join("\n")
    }, { quoted: msg });
  }

  fs.writeFileSync(ruta, JSON.stringify(nuevaLista, null, 2));
  global.owner = nuevaLista;

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  return conn.sendMessage(chatId, {
    text: "✅ Owner eliminado correctamente.\n\n" +
      "🗑️ Eliminados:\n" +
      eliminados.map(function(v) { return "• " + v; }).join("\n") +
      (candidatos.length > eliminados.length ?
        "\n\nℹ️ No encontrados:\n" +
        candidatos.filter(function(v) {
          return eliminados.indexOf(v) === -1;
        }).map(function(v) { return "• " + v; }).join("\n")
        : "")
  }, { quoted: msg });
};

handler.command = ["delowner"];
export default handler;
