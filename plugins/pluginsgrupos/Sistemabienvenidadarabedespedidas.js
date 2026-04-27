
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");
// Cache global de admins por chat
const adminCache = {};
// ==== HELPERS LID/REAL ====
const DIGITS = (s = "") => String(s || "").replace(/\D/g, "");

/** Si id es @lid y existe .jid (real), usa el real */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid)
        ? v.jid
        : v.id,
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch {
    return participants || [];
  }
}

/** Con metadata y un JID (real o @lid) → { realJid, lidJid, number } */
function resolveRealFromMeta(meta, anyJid) {
  const out = { realJid: null, lidJid: null, number: null };
  const raw  = Array.isArray(meta?.participants) ? meta.participants : [];
  const norm = lidParser(raw);

  if (typeof anyJid === "string" && anyJid.endsWith("@s.whatsapp.net")) {
    out.realJid = anyJid;
    // buscar su par @lid (si existe)
    for (let i = 0; i < raw.length; i++) {
      if (norm[i]?.id === out.realJid && typeof raw[i]?.id === "string" && raw[i].id.endsWith("@lid")) {
        out.lidJid = raw[i].id;
        break;
      }
    }
  } else if (typeof anyJid === "string" && anyJid.endsWith("@lid")) {
    out.lidJid = anyJid;
    const idx = raw.findIndex(p => p?.id === anyJid);
    if (idx >= 0) {
      const w = raw[idx];
      if (typeof w?.jid === "string" && w.jid.endsWith("@s.whatsapp.net")) out.realJid = w.jid;
      else if (typeof norm[idx]?.id === "string" && norm[idx].id.endsWith("@s.whatsapp.net")) out.realJid = norm[idx].id;
    }
  }

  out.number = DIGITS(out.realJid || "");
  return out;
}
// ==== FIN HELPERS ====
const handler = async (conn) => {
  conn.ev.on("group-participants.update", async (update) => {
    try {
      const chatId = update.id;
      const isGroup = chatId.endsWith("@g.us");
      if (!isGroup) return;
//bueno
if (!adminCache[chatId]) {
  const oldMeta = await conn.groupMetadata(chatId);
  adminCache[chatId] = new Set(
    oldMeta.participants
      .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
      .map(p => p.id)
  );
}
//ok      
      const welcomeActive = await getConfig(chatId, "welcome");
      const byeActive = await getConfig(chatId, "despedidas");
      const antiArabe = await getConfig(chatId, "antiarabe");

      const setwelcomePath = path.resolve("setwelcome.json");
      const personalizados = fs.existsSync(setwelcomePath)
        ? JSON.parse(fs.readFileSync(setwelcomePath, "utf-8"))[chatId] || {}
        : {};

      const bienvenidaPersonalizada = personalizados?.bienvenida;
      const despedidaPersonalizada = personalizados?.despedida;

      const mensajesBienvenida = [
        "🌟 ¡Bienvenid@ al grupo! Esperamos que la pases de lo mejor 🎉",
        "🎈 ¡Hola hola! Gracias por unirte, disfruta tu estadía✨️",
        "✨ ¡Nuevo miembro ha llegado! Que empiece la fiesta 🎊",
        "😯 ¡Hey! Te damos la bienvenida con los brazos abiertos🤗",
        "💥 ¡Un guerrero más se une a la aventura! Bienvenid@ 😎"
      ];

      const mensajesDespedida = [
        "😈 ¡Adiós! Esperamos de nuevo.",
        "😆 Se ha ido un miembro. ¡Buena suerte!",
        "🚪 Alguien ha salido del grupo. ¡Hasta luego!",
        "📤 Un compañero ha partido, ¡le deseamos lo mejor!",
        "💨 Se ha ido volando... ¡Bye bye!"
      ];

      const arabes = [
        "20", "212", "213", "216", "218", "222", "224", "230", "234", "235", "237", "238", "249",
        "250", "251", "252", "253", "254", "255", "257", "258", "260", "263", "269", "960", "961",
        "962", "963", "964", "965", "966", "967", "968", "970", "971", "972", "973", "974", "975",
        "976", "980", "981", "992", "994", "995", "998"
      ];

      const metadata = await conn.groupMetadata(chatId);



      
// 🔰 Aviso simple cuando ascienden a admin
if (update.action === "promote" && update.participants?.length) {
  const actor = update.author;
  const target = update.participants[0];
  if (actor && target) {
    const texto = `
╭──『 👑 *NUEVO ADMIN* 』─◆
│ 👤 Usuario: @${target.split("@")[0]}
│ ✅ Ascendido por: @${actor.split("@")[0]}
╰────────────────────◆`.trim();

    await conn.sendMessage(chatId, {
      text: texto,
      mentions: [actor, target]
    });
  }
}


      
// 🔒 FIN SISTEMA DE PROTECCIÓN Y AVISO DE CAMBIOS DE ADMIN 🔒
      for (const participant of update.participants) {
        const { realJid, lidJid, number } = resolveRealFromMeta(metadata, participant);

// para mencionar, usa el real si existe (mejor soporte en LID):
const mentionId = realJid || participant;
const phoneForMention = number || participant.split("@")[0];
const mention = `@${phoneForMention}`;

        if (update.action === "add") {
  // ahora validamos con el NÚMERO REAL
  const isArabic = (antiArabe == 1) && number && arabes.some(cc => number.startsWith(cc));

  if (isArabic) {
    const info = metadata.participants.find(p => p.id === participant);
    const isAdmin = info?.admin === "admin" || info?.admin === "superadmin";
    // para owner, mejor pasar número real si tu helper lo soporta
    const isOwner = global.isOwner && (global.isOwner(number) || global.isOwner(mentionId));

    if (!isAdmin && !isOwner) {
      await conn.sendMessage(chatId, {
        text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
        mentions: [mentionId]
      });
      try {
        await conn.groupParticipantsUpdate(chatId, [participant], "remove");
      } catch {}
      continue; // no enviar bienvenida
    }
  }

  // … (sigue tu bienvenida normal)

          if (welcomeActive != 1) continue;

          let perfilURL;
          try {
            perfilURL = await conn.profilePictureUrl(participant, "image");
          } catch {
            try {
              perfilURL = await conn.profilePictureUrl(chatId, "image");
            } catch {
              perfilURL = "https://cdn.russellxz.click/e72cc417.jpeg";
            }
          }

          if (bienvenidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}

${bienvenidaPersonalizada}`,
              mentions: [mentionId]
            });
          } else {
            const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
                caption: `👋 ${mention}

${mensaje}`,
                mentions: [mentionId]
              });
            } else {
              const avatar = await loadImage(perfilURL);
              const fondo = await loadImage("https://cdn.russellxz.click/e72cc417.jpeg");
              const canvas = createCanvas(1080, 720);
              const ctx = canvas.getContext("2d");
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
                caption: `👋 ${mention}

${mensaje}`,
                mentions: [participant]
              });
            }
          }

        } else if (update.action === "remove" && byeActive == 1) {
          let perfilURL;
          try {
            perfilURL = await conn.profilePictureUrl(participant, "image");
          } catch {
            try {
              perfilURL = await conn.profilePictureUrl(chatId, "image");
            } catch {
              perfilURL = "https://cdn.russellxz.click/e72cc417.jpeg";
            }
          }

          if (despedidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}

${despedidaPersonalizada}`,
              mentions: [participant]
            });
          } else {
            const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
                caption: `👋 ${mention}

${mensaje}`,
                mentions: [participant]
              });
            } else {
              const avatar = await loadImage(perfilURL);
              const fondo = await loadImage("https://cdn.russellxz.click/86913470.jpeg");
              const canvas = createCanvas(1080, 720);
              const ctx = canvas.getContext("2d");
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
                caption: `👋 ${mention}

${mensaje}`,
                mentions: [participant]
              });
            }
          }
        }
      }
//ok
const newMeta = await conn.groupMetadata(chatId);
adminCache[chatId] = new Set(
  newMeta.participants
    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    .map(p => p.id)
);
      //ok
      
      
    } catch (err) {
      console.error("❌ Error en lógica de grupo:", err);
    }
  });
};

handler.run = handler;
module.exports = handler;
