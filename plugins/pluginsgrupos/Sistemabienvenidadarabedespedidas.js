const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

const adminCache = {};
const DIGITS = function(s) { return String(s || "").replace(/D/g, ""); };

function isLidJid(j) { return typeof j === "string" && j.endsWith("@lid"); }
function isUserJid(j) { return typeof j === "string" && j.endsWith("@s.whatsapp.net"); }

// Resuelve cualquier JID (real o LID) al número real usando metadata + lidMap global
function resolveNumber(anyJid, metaParticipants) {
  if (!anyJid) return "";

  // 1) Ya es @s.whatsapp.net — extraer dígitos
  if (isUserJid(anyJid)) return DIGITS(anyJid.split(":")[0]);

  // 2) Es @lid — buscar en lidMap global primero
  if (isLidJid(anyJid) && global.lidMap instanceof Map) {
    var resolved = global.lidMap.get(anyJid);
    if (resolved && isUserJid(resolved)) return DIGITS(resolved.split(":")[0]);
  }

  // 3) Buscar en participants: si p.id === anyJid y tiene p.jid real
  if (Array.isArray(metaParticipants)) {
    for (var i = 0; i < metaParticipants.length; i++) {
      var p = metaParticipants[i];
      if (p.id === anyJid && p.jid && isUserJid(p.jid)) return DIGITS(p.jid.split(":")[0]);
    }
  }

  // 4) Fallback: solo dígitos del JID (puede ser incorrecto en LID, pero mejor que nada)
  return DIGITS(anyJid.split(":")[0].split("@")[0]);
}

// Devuelve el mejor JID para mencionar (preferir @s.whatsapp.net)
function resolveMentionJid(anyJid, metaParticipants) {
  if (!anyJid) return anyJid;
  if (isUserJid(anyJid)) return anyJid;

  // Resolver LID → JID real
  if (isLidJid(anyJid)) {
    if (global.lidMap instanceof Map) {
      var r = global.lidMap.get(anyJid);
      if (r && isUserJid(r)) return r;
    }
    if (Array.isArray(metaParticipants)) {
      for (var i = 0; i < metaParticipants.length; i++) {
        var p = metaParticipants[i];
        if (p.id === anyJid && p.jid && isUserJid(p.jid)) return p.jid;
      }
    }
  }

  return anyJid;
}

var handler = async function(conn) {
  conn.ev.on("group-participants.update", async function(update) {
    try {
      var chatId = update.id;
      if (!chatId || !chatId.endsWith("@g.us")) return;

      var action = update.action;
      var participants = Array.isArray(update.participants) ? update.participants : [];
      var actor = update.author || null;

      // Obtener metadata ANTES de procesar (para tener estado actual del grupo)
      var metadata;
      try {
        metadata = await conn.groupMetadata(chatId);
      } catch(e) {
        console.error("[welcome] no se pudo obtener metadata:", e);
        return;
      }

      var metaParts = Array.isArray(metadata && metadata.participants) ? metadata.participants : [];

      // Leer configs
      var welcomeActive = await getConfig(chatId, "welcome");
      var byeActive     = await getConfig(chatId, "despedidas");
      var antiArabe     = await getConfig(chatId, "antiarabe");

      var setwelcomePath = path.resolve("setwelcome.json");
      var personalizados = {};
      if (fs.existsSync(setwelcomePath)) {
        try {
          var swData = JSON.parse(fs.readFileSync(setwelcomePath, "utf-8"));
          personalizados = swData[chatId] || {};
        } catch(e) {}
      }

      var bienvenidaPersonalizada = personalizados.bienvenida || null;
      var despedidaPersonalizada  = personalizados.despedida  || null;

      var mensajesBienvenida = [
        "🌟 ¡Bienvenid@ al grupo! Esperamos que la pases de lo mejor 🎉",
        "🎈 ¡Hola hola! Gracias por unirte, disfruta tu estadía✨️",
        "✨ ¡Nuevo miembro ha llegado! Que empiece la fiesta 🎊",
        "😯 ¡Hey! Te damos la bienvenida con los brazos abiertos🤗",
        "💥 ¡Un guerrero más se une a la aventura! Bienvenid@ 😎"
      ];

      var mensajesDespedida = [
        "😈 ¡Adiós! Esperamos verte de nuevo.",
        "😆 Se ha ido un miembro. ¡Buena suerte!",
        "🚪 Alguien ha salido del grupo. ¡Hasta luego!",
        "📤 Un compañero ha partido, ¡le deseamos lo mejor!",
        "💨 Se ha ido volando... ¡Bye bye!"
      ];

      var arabes = [
        "20","212","213","216","218","222","224","230","234","235","237","238","249",
        "250","251","252","253","254","255","257","258","260","263","269","960","961",
        "962","963","964","965","966","967","968","970","971","972","973","974","975",
        "976","980","981","992","994","995","998"
      ];

      // ============================================================
      // PROMOTE: alguien fue ascendido a admin
      // ============================================================
      if (action === "promote" && participants.length) {
        for (var i = 0; i < participants.length; i++) {
          var target = participants[i];
          var targetMention = resolveMentionJid(target, metaParts);
          var targetNum     = resolveNumber(target, metaParts);
          var actorMention  = actor ? resolveMentionJid(actor, metaParts) : null;
          var actorNum      = actor ? resolveNumber(actor, metaParts) : null;

          var mentions = [targetMention];
          if (actorMention) mentions.push(actorMention);

          var texto = "╭──『 👑 *NUEVO ADMIN* 』─◆
" +
            "│ 👤 Nuevo admin: @" + targetNum + "
" +
            (actorNum ? "│ ✅ Ascendido por: @" + actorNum + "
" : "") +
            "╰────────────────────◆";

          await conn.sendMessage(chatId, { text: texto, mentions: mentions });
        }
        return;
      }

      // ============================================================
      // DEMOTE: alguien fue removido como admin
      // ============================================================
      if (action === "demote" && participants.length) {
        for (var i = 0; i < participants.length; i++) {
          var target = participants[i];
          var targetMention = resolveMentionJid(target, metaParts);
          var targetNum     = resolveNumber(target, metaParts);
          var actorMention  = actor ? resolveMentionJid(actor, metaParts) : null;
          var actorNum      = actor ? resolveNumber(actor, metaParts) : null;

          var mentions = [targetMention];
          if (actorMention) mentions.push(actorMention);

          var texto = "╭──『 ⬇️ *ADMIN REMOVIDO* 』─◆
" +
            "│ 👤 Usuario: @" + targetNum + "
" +
            (actorNum ? "│ ❌ Removido por: @" + actorNum + "
" : "") +
            "╰────────────────────◆";

          await conn.sendMessage(chatId, { text: texto, mentions: mentions });
        }
        return;
      }

      // ============================================================
      // ADD / REMOVE
      // ============================================================
      for (var i = 0; i < participants.length; i++) {
        var participant = participants[i];
        var mentionJid  = resolveMentionJid(participant, metaParts);
        var number      = resolveNumber(participant, metaParts);
        var mention     = "@" + number;

        // ── ANTIARABE ──────────────────────────────────────────────
        if (action === "add" && antiArabe == 1 && number) {
          var isArabic = arabes.some(function(cc) { return number.startsWith(cc); });

          if (isArabic) {
            var pInfo = metaParts.find(function(p) {
              return p.id === participant || p.id === mentionJid ||
                     DIGITS(p.id) === number || DIGITS(p.jid || "") === number;
            });
            var isAdminP = pInfo && (pInfo.admin === "admin" || pInfo.admin === "superadmin");
            var isOwnerP = typeof global.isOwner === "function" && (
              global.isOwner(number) || global.isOwner(mentionJid)
            );

            if (!isAdminP && !isOwnerP) {
              await conn.sendMessage(chatId, {
                text: "🚫 " + mention + " tiene un prefijo prohibido y será eliminado.",
                mentions: [mentionJid]
              });
              try { await conn.groupParticipantsUpdate(chatId, [participant], "remove"); } catch(e) {}
              continue;
            }
          }
        }

        // ── BIENVENIDA ─────────────────────────────────────────────
        if (action === "add") {
          if (welcomeActive != 1) continue;

          var perfilURL;
          try {
            perfilURL = await conn.profilePictureUrl(mentionJid, "image");
          } catch(e) {
            try { perfilURL = await conn.profilePictureUrl(chatId, "image"); }
            catch(e2) { perfilURL = "https://cdn.russellxz.click/e72cc417.jpeg"; }
          }

          if (bienvenidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: "👋 " + mention + "

" + bienvenidaPersonalizada,
              mentions: [mentionJid]
            });
          } else {
            var msgBien = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
            var modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
                caption: "👋 " + mention + "

" + msgBien,
                mentions: [mentionJid]
              });
            } else {
              try {
                var avatar = await loadImage(perfilURL);
                var fondo  = await loadImage("https://cdn.russellxz.click/e72cc417.jpeg");
                var canvas = createCanvas(1080, 720);
                var ctx    = canvas.getContext("2d");
                ctx.drawImage(fondo, 0, 0, canvas.width, canvas.height);
                ctx.save();
                ctx.beginPath();
                ctx.arc(150, 150, 85, 0, Math.PI * 2);
                ctx.closePath();
                ctx.clip();
                ctx.globalAlpha = 0.85;
                ctx.drawImage(avatar, 65, 65, 170, 170);
                ctx.restore();
                ctx.globalAlpha = 1.0;
                await conn.sendMessage(chatId, {
                  image: canvas.toBuffer(),
                  caption: "👋 " + mention + "

" + msgBien,
                  mentions: [mentionJid]
                });
              } catch(canvasErr) {
                // Si falla el canvas, enviar imagen directa
                await conn.sendMessage(chatId, {
                  image: { url: perfilURL },
                  caption: "👋 " + mention + "

" + msgBien,
                  mentions: [mentionJid]
                });
              }
            }
          }

        // ── DESPEDIDA ──────────────────────────────────────────────
        } else if (action === "remove") {
          if (byeActive != 1) continue;

          var perfilURL2;
          try {
            perfilURL2 = await conn.profilePictureUrl(mentionJid, "image");
          } catch(e) {
            try { perfilURL2 = await conn.profilePictureUrl(chatId, "image"); }
            catch(e2) { perfilURL2 = "https://cdn.russellxz.click/e72cc417.jpeg"; }
          }

          if (despedidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL2 },
              caption: "👋 " + mention + "

" + despedidaPersonalizada,
              mentions: [mentionJid]
            });
          } else {
            var msgBye = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
            var modo2  = Math.random() < 0.5 ? "video" : "imagen";

            if (modo2 === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
                caption: "👋 " + mention + "

" + msgBye,
                mentions: [mentionJid]
              });
            } else {
              try {
                var avatar2 = await loadImage(perfilURL2);
                var fondo2  = await loadImage("https://cdn.russellxz.click/86913470.jpeg");
                var canvas2 = createCanvas(1080, 720);
                var ctx2    = canvas2.getContext("2d");
                ctx2.drawImage(fondo2, 0, 0, canvas2.width, canvas2.height);
                ctx2.save();
                ctx2.beginPath();
                ctx2.arc(150, 150, 85, 0, Math.PI * 2);
                ctx2.closePath();
                ctx2.clip();
                ctx2.globalAlpha = 0.85;
                ctx2.drawImage(avatar2, 65, 65, 170, 170);
                ctx2.restore();
                ctx2.globalAlpha = 1.0;
                await conn.sendMessage(chatId, {
                  image: canvas2.toBuffer(),
                  caption: "👋 " + mention + "

" + msgBye,
                  mentions: [mentionJid]
                });
              } catch(canvasErr2) {
                await conn.sendMessage(chatId, {
                  image: { url: perfilURL2 },
                  caption: "👋 " + mention + "

" + msgBye,
                  mentions: [mentionJid]
                });
              }
            }
          }
        }
      }

    } catch(err) {
      console.error("❌ Error en lógica de grupo:", err);
    }
  });
};

handler.run = handler;
module.exports = handler;
