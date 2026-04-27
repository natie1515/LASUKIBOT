const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { getConfig } = requireFromRoot("db");

// Cache global de admins por chat
const adminCache = {};

// ==== HELPERS LID/REAL (mejorados para WhatsApp 2025-2026) ====

// ✅ Extrae solo números de forma segura
const DIGITS = (s = "") => String(s || "").replace(/[^0-9]/g, "");

// ✅ Fuerza a que cualquier JID se convierta en un texto limpio
const getJidStr = (obj) => {
  if (typeof obj === "string") return obj;
  if (!obj) return "";
  return obj.id || obj.jid || obj.lid || "";
};

// ✅ Detecta si es @lid o @s.whatsapp.net
const isLid = (jid) => typeof jid === "string" && jid.endsWith("@lid");
const isPn  = (jid) => typeof jid === "string" && jid.endsWith("@s.whatsapp.net");

// ✅ Limpia ":N" de dispositivos: "521234:5@s.whatsapp.net" → "521234@s.whatsapp.net"
const cleanJid = (jid) => String(jid || "").replace(/:\d+@/, "@");

/** Si id es @lid y existe .jid (real), usa el real */
function lidParser(participants = []) {
  try {
    return participants.map(v => ({
      id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v?.jid)
        ? v.jid
        : v.id,
      admin: v?.admin ?? null,
      raw: v
    }));
  } catch {
    return participants || [];
  }
}

/** 
 * Con metadata y un JID (real o @lid) → { realJid, lidJid, number }
 * MEJORADO: ahora también busca cruzando todos los campos (.id, .jid, .lid, .phoneNumber)
 */
function resolveRealFromMeta(meta, anyJid) {
  const out = { realJid: null, lidJid: null, number: null };
  const raw = Array.isArray(meta?.participants) ? meta.participants : [];

  // Aseguramos string puro
  const safeJid = cleanJid(getJidStr(anyJid));
  if (!safeJid) return out;

  // Caso 1: entra ya como número real
  if (isPn(safeJid)) {
    out.realJid = safeJid;
    // Buscar su par @lid en la metadata
    for (const p of raw) {
      const pid = cleanJid(getJidStr(p));
      const pjid = cleanJid(p?.jid || "");
      const plid = cleanJid(p?.lid || "");

      if (pjid === safeJid || pid === safeJid) {
        if (isLid(pid)) out.lidJid = pid;
        else if (plid && isLid(plid)) out.lidJid = plid;
        break;
      }
    }
  } 
  // Caso 2: entra como @lid → buscar el real
  else if (isLid(safeJid)) {
    out.lidJid = safeJid;

    // Estrategia A: buscar match directo en la metadata
    for (const p of raw) {
      const pid = cleanJid(getJidStr(p));
      const pjid = cleanJid(p?.jid || "");
      const plid = cleanJid(p?.lid || "");
      const pphone = cleanJid(p?.phoneNumber ? `${DIGITS(p.phoneNumber)}@s.whatsapp.net` : "");

      // Si el .id es nuestro lid, intentar tomar el .jid como real
      if (pid === safeJid) {
        if (isPn(pjid)) { out.realJid = pjid; break; }
        if (isPn(pphone)) { out.realJid = pphone; break; }
      }

      // Si el .lid del registro es nuestro lid, su .id (si es PN) es el real
      if (plid === safeJid && isPn(pid)) {
        out.realJid = pid;
        break;
      }
    }

    // Estrategia B: usar el lidParser por si acaso
    if (!out.realJid) {
      const norm = lidParser(raw);
      const idx = raw.findIndex(p => cleanJid(getJidStr(p)) === safeJid);
      if (idx >= 0 && norm[idx]?.id && isPn(norm[idx].id)) {
        out.realJid = norm[idx].id;
      }
    }
  }
  // Caso 3: ya viene en otro formato raro → usarlo como está
  else {
    out.realJid = safeJid;
  }

  // Número de teléfono limpio (preferir el real, fallback al lid)
  out.number = DIGITS(out.realJid || safeJid);
  return out;
}

/**
 * Para mencionar a alguien: necesitamos un JID válido en el array `mentions`.
 * En 2025-2026, WhatsApp acepta tanto @lid como @s.whatsapp.net en mentions.
 * Devolvemos los DOS si están disponibles para máxima compatibilidad.
 */
function buildMentions(realJid, lidJid, fallbackJid) {
  const mentions = [];
  if (realJid && isPn(realJid)) mentions.push(realJid);
  if (lidJid && isLid(lidJid)) mentions.push(lidJid);
  if (!mentions.length && fallbackJid) mentions.push(fallbackJid);
  return [...new Set(mentions.filter(Boolean).map(String))];
}

/**
 * Intenta obtener foto de perfil probando múltiples JIDs (real, lid, original)
 */
async function tryGetPic(conn, jids = [], chatId) {
  for (const jid of jids) {
    if (!jid) continue;
    try {
      const url = await conn.profilePictureUrl(jid, "image");
      if (url) return url;
    } catch {}
  }
  // Fallback: foto del grupo
  try {
    const url = await conn.profilePictureUrl(chatId, "image");
    if (url) return url;
  } catch {}
  return null;
}

// ==== FIN HELPERS ====

const handler = async (conn) => {
  conn.ev.on("group-participants.update", async (update) => {
    try {
      const chatId = update.id;
      const isGroup = chatId && chatId.endsWith("@g.us");
      if (!isGroup) return;

      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("👥 group-participants.update");
      console.log("➡️ Chat:", chatId);
      console.log("➡️ Action:", update.action);
      console.log("➡️ Participants:", (update.participants || []).join(", "));
      console.log("➡️ Author:", getJidStr(update.author) || "—");

      // Pequeño retardo para que la metadata refleje cambios recientes
      await new Promise(r => setTimeout(r, 350));

      const metadata = await conn.groupMetadata(chatId).catch(() => null);
      if (!metadata) {
        console.log("⚠️ Sin metadata, ignorando evento");
        return;
      }

      // Actualizar Cache de Admins Inicial
      if (!adminCache[chatId]) {
        adminCache[chatId] = new Set(
          metadata.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
            .map(p => getJidStr(p))
        );
      }

      // ⚙️ Leer configs (sin await porque getConfig es síncrono en tu sistema)
      const welcomeActive = getConfig(chatId, "welcome");
      const byeActive = getConfig(chatId, "despedidas");
      const antiArabe = getConfig(chatId, "antiarabe");

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
        const actorRaw = getJidStr(update.author);
        const actorRes = actorRaw ? resolveRealFromMeta(metadata, actorRaw) : { number: "" };
        const actorNum = actorRes.number || DIGITS(actorRaw) || "Desconocido";
        const actorMention = actorRes.realJid || actorRes.lidJid || actorRaw;

        for (const targetRaw of update.participants) {
          const target = getJidStr(targetRaw);
          if (!target) continue;

          const { realJid, lidJid, number } = resolveRealFromMeta(metadata, target);
          const targetNum = number || DIGITS(target);

          // ⭐ Mentions con TODOS los formatos disponibles
          const mencionesEfectivas = buildMentions(realJid, lidJid, target);
          if (actorMention) mencionesEfectivas.push(String(actorMention));

          if (update.action === "promote") {
            const texto = `╭──『 👑 *NUEVO ADMIN* 』─◆\n│ 👤 Usuario: @${targetNum}\n│ ✅ Ascendido por: @${actorNum}\n╰────────────────────◆`;
            await conn.sendMessage(chatId, {
              text: texto,
              mentions: [...new Set(mencionesEfectivas)]
            });
            console.log("✅ Promote anunciado:", targetNum);
          } else if (update.action === "demote") {
            const texto = `╭──『 📉 *ADMIN DEGRADADO* 』─◆\n│ 👤 Usuario: @${targetNum}\n│ ❌ Degradado por: @${actorNum}\n╰────────────────────◆`;
            await conn.sendMessage(chatId, {
              text: texto,
              mentions: [...new Set(mencionesEfectivas)]
            });
            console.log("✅ Demote anunciado:", targetNum);
          }
        }
      }

      // 🔄 SISTEMA DE BIENVENIDAS, DESPEDIDAS Y ANTIÁRABE
      for (const pRaw of update.participants) {
        const participant = getJidStr(pRaw);
        if (!participant) continue;

        const { realJid, lidJid, number } = resolveRealFromMeta(metadata, participant);

        // ⭐ Para mencionar usamos TODOS los formatos disponibles
        const mentionIds = buildMentions(realJid, lidJid, participant);
        const phoneForMention = number || DIGITS(participant);
        const mention = `@${phoneForMention}`;

        // ⭐ JIDs candidatos para foto de perfil (probamos en orden)
        const picCandidates = [realJid, lidJid, participant].filter(Boolean);

        if (update.action === "add") {
          // Validamos con el NÚMERO REAL
          const isArabic = (antiArabe == 1) && number && arabes.some(cc => number.startsWith(cc));

          if (isArabic) {
            // Buscamos si el usuario agregado es Admin o Owner (robusto)
            const info = metadata.participants.find(p => {
              const pid = cleanJid(getJidStr(p));
              const pjid = cleanJid(p?.jid || "");
              const plid = cleanJid(p?.lid || "");
              return pid === realJid || pid === lidJid || pid === participant ||
                     pjid === realJid || plid === lidJid;
            });
            const isAdmin = info?.admin === "admin" || info?.admin === "superadmin";

            const isOwner = Array.isArray(global.owner) && global.owner.some(function(entry) {
              let n = Array.isArray(entry) ? entry[0] : entry;
              return String(n).replace(/[^0-9]/g, "") === number;
            });

            if (!isAdmin && !isOwner) {
              await conn.sendMessage(chatId, {
                text: `🚫 ${mention} tiene un prefijo prohibido y será eliminado.`,
                mentions: mentionIds
              });
              try {
                // Para expulsar: probamos primero realJid, después lid, después original
                const targetForKick = realJid || lidJid || participant;
                await conn.groupParticipantsUpdate(chatId, [targetForKick], "remove");
              } catch (e) {
                console.log("⚠️ No se pudo expulsar:", e.message);
              }
              continue; // Salta la bienvenida si fue expulsado
            }
          }

          if (welcomeActive != 1) continue;

          // ⭐ Foto de perfil con múltiples intentos (LID + real + grupo + fallback)
          let perfilURL = await tryGetPic(conn, picCandidates, chatId);
          if (!perfilURL) {
            perfilURL = "https://cdn.russellxz.click/e72cc417.jpeg";
          }

          if (bienvenidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}\n\n${bienvenidaPersonalizada}`,
              mentions: mentionIds
            });
          } else {
            const mensaje = mensajesBienvenida[Math.floor(Math.random() * mensajesBienvenida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/8e968c1d.mp4" },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: mentionIds
              });
            } else {
              try {
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
                  mentions: mentionIds
                });
              } catch (e) {
                // Si el canvas falla (URL de imagen rota), enviar como imagen normal
                console.log("⚠️ Canvas falló, fallback a imagen directa:", e.message);
                await conn.sendMessage(chatId, {
                  image: { url: perfilURL },
                  caption: `👋 ${mention}\n\n${mensaje}`,
                  mentions: mentionIds
                });
              }
            }
          }

          console.log("✅ Bienvenida enviada a:", phoneForMention);

        } else if (update.action === "remove" && byeActive == 1) {
          // ⭐ Foto de perfil con múltiples intentos
          let perfilURL = await tryGetPic(conn, picCandidates, chatId);
          if (!perfilURL) {
            perfilURL = "https://cdn.russellxz.click/7177383b.jpg";
          }

          if (despedidaPersonalizada) {
            await conn.sendMessage(chatId, {
              image: { url: perfilURL },
              caption: `👋 ${mention}\n\n${despedidaPersonalizada}`,
              mentions: mentionIds
            });
          } else {
            const mensaje = mensajesDespedida[Math.floor(Math.random() * mensajesDespedida.length)];
            const modo = Math.random() < 0.5 ? "video" : "imagen";

            if (modo === "video") {
              await conn.sendMessage(chatId, {
                video: { url: "https://cdn.russellxz.click/6a4bd220.mp4" },
                caption: `👋 ${mention}\n\n${mensaje}`,
                mentions: mentionIds
              });
            } else {
              try {
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
                  mentions: mentionIds
                });
              } catch (e) {
                console.log("⚠️ Canvas falló en despedida, fallback:", e.message);
                await conn.sendMessage(chatId, {
                  image: { url: perfilURL },
                  caption: `👋 ${mention}\n\n${mensaje}`,
                  mentions: mentionIds
                });
              }
            }
          }

          console.log("✅ Despedida enviada de:", phoneForMention);
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
