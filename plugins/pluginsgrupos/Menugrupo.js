// plugins/menugrupo.js — Menú de Grupo con Botones
// Si botones están ON: envía el video/gif + caption + menú desplegable con todos los comandos
// Si botones están OFF: envía el video/gif con el menú clásico en texto
// Al tocar un comando: WhatsApp envía el texto del comando con prefijo y el bot lo ejecuta.
// Los on/off están duplicados (welcome on, welcome off) para activar/desactivar rápido.

"use strict";

const fs = require("fs");
const path = require("path");

const ACTIVOSS_FILE = path.resolve("./activoss.json");

function botonesActivos() {
  const defaultCfg = { botones: true, updatedAt: null, updatedBy: null };
  if (!fs.existsSync(ACTIVOSS_FILE)) {
    try { fs.writeFileSync(ACTIVOSS_FILE, JSON.stringify(defaultCfg, null, 2)); } catch {}
    return true;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(ACTIVOSS_FILE, "utf-8"));
    return cfg.botones !== false;
  } catch {
    return true;
  }
}

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "✨", key: msg.key } }, msg); } catch {}

  // ====== LEER CONFIG PERSONALIZADA (setmenu.json) ======
  let customText = null;
  let customImgB64 = null;

  try {
    const filePath = path.resolve("./setmenu.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (typeof data?.texto_grupo === "string" && data.texto_grupo.trim().length) {
        customText = data.texto_grupo;
      }
      if (typeof data?.imagen_grupo === "string" && data.imagen_grupo.length) {
        customImgB64 = data.imagen_grupo;
      }
    }
  } catch (e) {
    console.error("[menugrupo] error leyendo setmenu.json:", e);
  }

  // Si hay config personalizada, se respeta (prioridad máxima)
  if (customText || customImgB64) {
    try {
      if (customImgB64) {
        const buf = Buffer.from(customImgB64, "base64");
        await conn.sendMessage2(
          chatId,
          { image: buf, caption: customText || "" },
          msg
        );
      } else {
        await conn.sendMessage2(chatId, { text: customText }, msg);
      }
    } catch (e) {
      console.error("[menugrupo] error enviando personalizado:", e);
    }
    return;
  }

  const usarBotones = botonesActivos();

  // ====== CAPTION COMPLETO (siempre se muestra con el video) ======
  const captionCompleto = `╔════════════════╗
     💠 𝙱𝙸𝙴𝙽𝚅𝙴𝙽𝙸𝙳𝙾 💠
╚════════════════╝
*𝐴𝑙 𝑚𝑒𝑛𝑢 𝑑𝑒 𝑔𝑟𝑢𝑝𝑜 𝑑𝑒 𝐿𝑎 𝑆𝑢𝑘𝑖 𝐵𝑜𝑡*

🛠️ *CONFIGURACIONES*
╭─────◆
│๛ ${pref}infogrupo
│๛ ${pref}setinfo
│๛ ${pref}setname
│๛ ${pref}setwelcome
│๛ ${pref}setdespedidas
│๛ ${pref}setfoto
│๛ ${pref}setreglas
│๛ ${pref}reglas
│๛ ${pref}welcome on
│๛ ${pref}welcome off
│๛ ${pref}despedidas on
│๛ ${pref}despedidas off
│๛ ${pref}modoadmins on
│๛ ${pref}modoadmins off
│๛ ${pref}antilink on
│๛ ${pref}antilink off
│๛ ${pref}linkall on
│๛ ${pref}linkall off
│๛ ${pref}antis on
│๛ ${pref}antis off
│๛ ${pref}antidelete on
│๛ ${pref}antidelete off
│๛ ${pref}antiarabe on
│๛ ${pref}antiarabe off
│๛ ${pref}configrupo
│๛ ${pref}addco / comando a Stikerz
│๛ ${pref}delco / elimina comandos en s
╰─────◆

🛡️ *ADMINISTRACIÓN*
╭─────◆
│๛ ${pref}daradmins
│๛ ${pref}quitaradmins
│๛ ${pref}kick
│๛ ${pref}tag
│๛ ${pref}tagall
│๛ ${pref}todos
│๛ ${pref}invocar
│๛ ${pref}totalchat
│๛ ${pref}restchat
│๛ ${pref}fantasmas
│๛ ${pref}fankick
│๛ ${pref}delete
│๛ ${pref}linkgrupo
│๛ ${pref}mute
│๛ ${pref}unmute
│๛ ${pref}ban
│๛ ${pref}unban
│๛ ${pref}restpro
│๛ ${pref}abrir / automáticamente
│๛ ${pref}cerrar / automáticamente
│๛ ${pref}abrirgrupo
│๛ ${pref}cerrargrupo
╰─────◆

🤖 *La Suki Bot - Panel de control grupal*
`.trim();

  // ====== BOTONES NATIVOS ======
  // IMPORTANTE: el "title" de cada row es lo que WhatsApp envía como texto
  // cuando el usuario toca esa opción. Por eso el title debe ser EXACTAMENTE
  // el comando con prefijo, SIN emojis ni decoración.
  const nativeFlowButtons = [
    {
      text: "📋 Menú de grupo",
      sections: [
        {
          title: "🛠️ CONFIGURACIONES",
          highlight_label: "SETUP",
          rows: [
            { header: "", title: `${pref}infogrupo`, id: `${pref}infogrupo` },
            { header: "", title: `${pref}setinfo`, id: `${pref}setinfo` },
            { header: "", title: `${pref}setname`, id: `${pref}setname` },
            { header: "", title: `${pref}setfoto`, id: `${pref}setfoto` },
            { header: "", title: `${pref}setwelcome`, id: `${pref}setwelcome` },
            { header: "", title: `${pref}setdespedidas`, id: `${pref}setdespedidas` },
            { header: "", title: `${pref}setreglas`, id: `${pref}setreglas` },
            { header: "", title: `${pref}reglas`, id: `${pref}reglas` },
            { header: "", title: `${pref}configrupo`, id: `${pref}configrupo` },
            { header: "", title: `${pref}addco`, id: `${pref}addco` },
            { header: "", title: `${pref}delco`, id: `${pref}delco` },
          ],
        },
        {
          title: "✅ ACTIVAR FUNCIONES",
          highlight_label: "ON",
          rows: [
            { header: "", title: `${pref}welcome on`, id: `${pref}welcome on` },
            { header: "", title: `${pref}despedidas on`, id: `${pref}despedidas on` },
            { header: "", title: `${pref}modoadmins on`, id: `${pref}modoadmins on` },
            { header: "", title: `${pref}antilink on`, id: `${pref}antilink on` },
            { header: "", title: `${pref}linkall on`, id: `${pref}linkall on` },
            { header: "", title: `${pref}antis on`, id: `${pref}antis on` },
            { header: "", title: `${pref}antidelete on`, id: `${pref}antidelete on` },
            { header: "", title: `${pref}antiarabe on`, id: `${pref}antiarabe on` },
          ],
        },
        {
          title: "❌ DESACTIVAR FUNCIONES",
          highlight_label: "OFF",
          rows: [
            { header: "", title: `${pref}welcome off`, id: `${pref}welcome off` },
            { header: "", title: `${pref}despedidas off`, id: `${pref}despedidas off` },
            { header: "", title: `${pref}modoadmins off`, id: `${pref}modoadmins off` },
            { header: "", title: `${pref}antilink off`, id: `${pref}antilink off` },
            { header: "", title: `${pref}linkall off`, id: `${pref}linkall off` },
            { header: "", title: `${pref}antis off`, id: `${pref}antis off` },
            { header: "", title: `${pref}antidelete off`, id: `${pref}antidelete off` },
            { header: "", title: `${pref}antiarabe off`, id: `${pref}antiarabe off` },
          ],
        },
        {
          title: "🛡️ ADMINISTRACIÓN",
          highlight_label: "ADMIN",
          rows: [
            { header: "", title: `${pref}daradmins`, id: `${pref}daradmins` },
            { header: "", title: `${pref}quitaradmins`, id: `${pref}quitaradmins` },
            { header: "", title: `${pref}kick`, id: `${pref}kick` },
            { header: "", title: `${pref}ban`, id: `${pref}ban` },
            { header: "", title: `${pref}unban`, id: `${pref}unban` },
            { header: "", title: `${pref}mute`, id: `${pref}mute` },
            { header: "", title: `${pref}unmute`, id: `${pref}unmute` },
            { header: "", title: `${pref}delete`, id: `${pref}delete` },
          ],
        },
        {
          title: "👥 ETIQUETAR",
          highlight_label: "TAG",
          rows: [
            { header: "", title: `${pref}tag`, id: `${pref}tag` },
            { header: "", title: `${pref}tagall`, id: `${pref}tagall` },
            { header: "", title: `${pref}todos`, id: `${pref}todos` },
            { header: "", title: `${pref}invocar`, id: `${pref}invocar` },
            { header: "", title: `${pref}totalchat`, id: `${pref}totalchat` },
            { header: "", title: `${pref}restchat`, id: `${pref}restchat` },
            { header: "", title: `${pref}fantasmas`, id: `${pref}fantasmas` },
            { header: "", title: `${pref}fankick`, id: `${pref}fankick` },
            { header: "", title: `${pref}linkgrupo`, id: `${pref}linkgrupo` },
            { header: "", title: `${pref}restpro`, id: `${pref}restpro` },
          ],
        },
        {
          title: "🔓 ABRIR / CERRAR GRUPO",
          highlight_label: "LOCK",
          rows: [
            { header: "", title: `${pref}abrir`, id: `${pref}abrir` },
            { header: "", title: `${pref}cerrar`, id: `${pref}cerrar` },
            { header: "", title: `${pref}abrirgrupo`, id: `${pref}abrirgrupo` },
            { header: "", title: `${pref}cerrargrupo`, id: `${pref}cerrargrupo` },
          ],
        },
      ],
    },
  ];

  // ====== ENVIAR ======
  if (usarBotones) {
    try {
      await conn.sendMessage2(
        chatId,
        {
          video: { url: "https://cdn.russellxz.click/29906d1e.mp4" },
          gifPlayback: true,
          caption: captionCompleto,
          footer: "❦ La Suki Bot — Panel de Grupo ❦",
          buttons: nativeFlowButtons,
          headerType: 4,
        },
        msg
      );
      return;
    } catch (e) {
      console.log("[menugrupo] menú nativo falló, fallback a video sin botones:", e.message);
    }
  }

  await conn.sendMessage2(
    chatId,
    {
      video: { url: "https://cdn.russellxz.click/29906d1e.mp4" },
      gifPlayback: true,
      caption: captionCompleto,
    },
    msg
  );
};

handler.command = ["menugrupo", "grupomenu"];
handler.help = ["menugrupo"];
handler.tags = ["menu"];

module.exports = handler;
