import fs from 'fs';
import path from 'path';

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
    var msg2 = msg.message || {};
    return (
      (msg2.extendedTextMessage && msg2.extendedTextMessage.contextInfo) ||
      (msg2.imageMessage && msg2.imageMessage.contextInfo) ||
      (msg2.videoMessage && msg2.videoMessage.contextInfo) ||
      (msg2.documentMessage && msg2.documentMessage.contextInfo) ||
      (msg2.audioMessage && msg2.audioMessage.contextInfo) ||
      (msg2.stickerMessage && msg2.stickerMessage.contextInfo) ||
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
      text: "🚫 Solo los owners o el mismo bot pueden usar este comando."
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
      text: "⚠️ Usa:\n.addowner 507xxxxxxx o cita un mensaje.\n\nℹ️ Guardara el numero base, la version con 0 y el LID si esta disponible."
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

  var existentes = new Set();
  for (var k = 0; k < lista.length; k++) {
    var item = lista[k];
    if (Array.isArray(item)) {
      for (var l = 0; l < item.length; l++) {
        var d = onlyDigits(item[l]);
        if (d) existentes.add(d);
      }
    } else {
      var d2 = onlyDigits(item);
      if (d2) existentes.add(d2);
    }
  }

  var porGuardar = [];
  if (baseNumber) porGuardar.push(baseNumber);
  if (zeroNumber && zeroNumber !== baseNumber) porGuardar.push(zeroNumber);
  if (lidNumber && lidNumber !== baseNumber && lidNumber !== zeroNumber) porGuardar.push(lidNumber);

  var agregados = [];
  for (var m2 = 0; m2 < porGuardar.length; m2++) {
    var n = porGuardar[m2];
    if (!existentes.has(n)) {
      lista.push([n]);
      existentes.add(n);
      agregados.push(n);
    }
  }

  if (!agregados.length) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, {
      text: "⚠️ Todos los numeros ya estaban guardados como owner.\n" +
        "➤ Base: " + (baseNumber || "—") + "\n" +
        "➤ Con 0: " + (zeroNumber || "—") + "\n" +
        "➤ LID: " + (lidNumber || "No disponible")
    }, { quoted: msg });
  }

  fs.writeFileSync(ruta, JSON.stringify(lista, null, 2));
  global.owner = lista;

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  var textoFinal = "✅ Owner agregado correctamente.\n" +
    "➤ Base: " + (baseNumber || "—") + "\n" +
    "➤ Con 0: " + (zeroNumber || "—") + "\n" +
    "➤ LID: " + (lidNumber || "No disponible") + "\n\n" +
    "📌 Guardados nuevos:\n";

  for (var ag = 0; ag < agregados.length; ag++) {
    textoFinal += "• " + agregados[ag] + "\n";
  }

  return conn.sendMessage(chatId, { text: textoFinal.trim() }, { quoted: msg });
};

handler.command = ["addowner"];
export default handler;
