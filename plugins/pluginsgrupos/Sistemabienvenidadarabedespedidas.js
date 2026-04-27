const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

// Cache global de admins por chat
const adminCache = {};

// ==== HELPERS LID/REAL ====
// ✅ Extrae solo números de forma segura
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// ✅ Fuerza a que cualquier JID se convierta en un texto limpio (evita el error de "Object")
const getJidStr = (obj) => typeof obj === "string" ? obj : (obj?.id || "");

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
  
  // Aseguramos que trabajamos con string puro
  const safeJid = getJidStr(anyJid);

  if (safeJid.endsWith("@s.whatsapp.net")) {
    out.realJid = safeJid;
    // buscar su par @lid (si existe)
    for (let i = 0; i < raw.length; i++) {
      if (norm[i]?.id === out.realJid && typeof raw[i]?.id === "string" && raw[i].id.endsWith("@lid")) {
        out.lidJid = raw[i].id;
        break;
      }
    }
  } else if (safeJid.endsWith("@lid")) {
    out.lidJid = safeJid;
    const idx = raw.findIndex(p => p?.id === safeJid);
    if (idx >= 0) {
      const w = raw[idx];
      if (typeof w?.jid === "string" && w.jid.endsWith("@s.whatsapp.net")) out.realJid = w.jid;
      else if (typeof norm[idx]?.id === "string" && norm[idx].id.endsWith("@s.whatsapp.net")) out.realJid = norm[idx].id;
    }
  }

  // Extrae número usando real o fallback al original
  out.number = DIGITS(out.realJid || safeJid);
  return out;
}
// ==== FIN HELPERS ====

const handler = async (conn) => {
  conn.ev.on("group-participants.update", async (update) => {
    try {
      const chatId = update.id;
      const isGroup = chatId.endsWith("@g.us");
      if (!isGroup) return;

      const metadata = await conn.groupMetadata(chatId).catch(() => null);
      if (!metadata) return; // Protección si la metadata falla

      // Actualizar Cache de Admins Inicial
      if (!adminCache[chatId]) {
        adminCache[chatId] = new Set(
          metadata.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => getJidStr(p))
        );
      }
      
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

      // 🔰 SISTEMA DE AVISO DE CAMBIOS DE ADMIN (PROMOTE Y DEMOTE)
      if (update.action === "promote" || update.action === "demote") {
        const actor = getJidStr(update.author);
        const actorNum = actor ? DIGITS(actor) : "Desconocido";

        for (const targetRaw of update.participants) {
          const target = getJidStr(targetRaw);
          if (!target) continue;

          const { realJid, number } = resolveRealFromMeta(metadata, target);
          const targetNum = number || DIGITS(target);
          const targetMention = realJid || target;

          const mencionesEfectivas = [targetMention, actor].filter(Boolean).map(String);

          if (update.action === "promote") {
            const texto = `╭──『 👑 *NUEVO ADMIN* 』─◆\n│ 👤 Usuario: @${targetNum}\n│ ✅ Ascendido por: @${actorNum}\n╰────────────────────◆`;
            await conn.sendMessage(chatId, {
              text: texto,
              mentions: mencionesEfectivas
            });
          } else if (update.action === "demote") {
            const texto = `╭──『 📉 *ADMIN DEGRADADO* 』─◆\n│ 👤 Usuario: @${targetNum}\n│ ❌ Degradado por: @${actorNum}\n╰────────────────────◆`;
            await conn.sendMessage(chatId, {
              text: texto,
              mentions: mencionesEfectivas
            });
          }
        }
      }

      // 🔄 SISTEMA DE BIENVENIDAS, DESPEDIDAS Y ANTIÁRABE
      for (const pRaw of update.participants) {
        const participant = getJidStr(pRaw);
        if (!participant) continue;

        const { realJid, lidJid, number } = resolveRealFromMeta(metadata, participant);

        // Para mencionar, usa el real si existe (mejor soporte en LID)
        const mentionId = String(realJid || participant);
        const phoneForMention = number || DIGITS(participant);
        const mention = `@${phoneForMention}`;

        if (update.action === "add") {
          // Validamos con el NÚMERO REAL
          const isArabic = (antiArabe == 1) && number && arabes.some(cc => number.startsWith(cc));

          if (isArabic) {
            // Buscamos si el usuario agregado es Admin o Owner (robusto)
            const info = metadata.participants.find(p => getJidStr(p) === realJid || getJidStr(p) === lidJid || getJidStr(p) === participant);
            const isAdmin = info?.admin === "admin" || info?.admin === "superadmin";
            
            const isOwner = Array.isArray(global.owner) && global.owner.some(function(entry) {
              let n = Array.isArray(entry) ? entry[0] : entry;
              return String(n).replace(/[^0-9]/g, "") === number;
            });

            if (!isAdmin && !isOwner) {
              await conn.sendMessage(chatId, {
                text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
                mentions: [mentionId]
              });
              try {
                await conn.groupParticipantsUpdate(chatId, [participant], "remove");
              } catch {}
              continue; // Salta la bienvenida si fue expulsado
            }
          }

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
              caption: `👋 ${mention}\n\n${bienvenidaPersonalizada}`,
              mentions: [mentionId]
            });
          } else {
            const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            } else {
              const avatar = await loadImage(perfilURL);
              const fondo = await loadImage("https://cdn.russellxz.click/7177383b.jpg");
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

              // ✅ Buffer.from garantiza que sea un Buffer nativo para evitar crasheos
              await conn.sendMessage(chatId, {
                image: Buffer.from(canvas.toBuffer("image/png")),
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
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
              perfilURL = "https://cdn.russellxz.click/7177383b.jpg";
            }
          }

          if (despedidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}\n\n${despedidaPersonalizada}`,
              mentions: [mentionId]
            });
          } else {
            const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            } else {
              const avatar = await loadImage(perfilURL);
              const fondo = await loadImage("https://cdn.russellxz.click/bc842c44.jpg");
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

              // ✅ Buffer.from garantiza que sea un Buffer nativo para evitar crasheos
              await conn.sendMessage(chatId, {
                image: Buffer.from(canvas.toBuffer("image/png")),
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: [mentionId]
              });
            }
          }
        }
      }

      // Actualizar Cache de Admins Final
      const newMeta = await conn.groupMetadata(chatId).catch(() => null);
      if (newMeta) {
        adminCache[chatId] = new Set(
          newMeta.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => getJidStr(p))
        );
      }
      
    } catch (err) {
      console.error("❌ Error en lógica de grupo:", err);
    }
  });
};

handler.run = handler;
module.exports = handler;
