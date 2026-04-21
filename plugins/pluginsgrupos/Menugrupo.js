// plugins/menugrupo.js — Menú de Grupo con Botones
// Si botones están ON: envía el video/gif + caption + menú desplegable con todos los comandos
// Si botones están OFF: envía el video/gif con el menú clásico en texto
// Al tocar un comando: WhatsApp envía SOLO el texto del comando con prefijo (sin description)
//   así el bot lo reconoce y lo ejecuta.
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
  // 🔑 CRÍTICO: NO usar "description" porque WhatsApp la envía junto con el title
  //    cuando el usuario toca una opción. Solo dejamos "title" con el comando puro.
  // 🔑 El header también vacío para evitar cualquier texto extra.
  const mk = (cmd) => ({
    header: "",
    title: `${pref}${cmd}`,
    id: `${pref}${cmd}`,
  });

  const nativeFlowButtons = [
    {
      text: "📋 Menú de grupo",
      sections: [
        {
          title: "🛠️ CONFIGURACIONES",
          highlight_label: "SETUP",
          rows: [
            mk("infogrupo"),
            mk("setinfo"),
            mk("setname"),
            mk("setfoto"),
            mk("setwelcome"),
            mk("setdespedidas"),
            mk("setreglas"),
            mk("reglas"),
            mk("configrupo"),
            mk("addco"),
            mk("delco"),
          ],
        },
        {
          title: "✅ ACTIVAR FUNCIONES",
          highlight_label: "ON",
          rows: [
            mk("welcome on"),
            mk("despedidas on"),
            mk("modoadmins on"),
            mk("antilink on"),
            mk("linkall on"),
            mk("antis on"),
            mk("antidelete on"),
            mk("antiarabe on"),
          ],
        },
        {
          title: "❌ DESACTIVAR FUNCIONES",
          highlight_label: "OFF",
          rows: [
            mk("welcome off"),
            mk("despedidas off"),
            mk("modoadmins off"),
            mk("antilink off"),
            mk("linkall off"),
            mk("antis off"),
            mk("antidelete off"),
            mk("antiarabe off"),
          ],
        },
        {
          title: "🛡️ ADMINISTRACIÓN",
          highlight_label: "ADMIN",
          rows: [
            mk("daradmins"),
            mk("quitaradmins"),
            mk("kick"),
            mk("ban"),
            mk("unban"),
            mk("mute"),
            mk("unmute"),
            mk("delete"),
          ],
        },
        {
          title: "👥 ETIQUETAR",
          highlight_label: "TAG",
          rows: [
            mk("tag"),
            mk("tagall"),
            mk("todos"),
            mk("invocar"),
            mk("totalchat"),
            mk("restchat"),
            mk("fantasmas"),
            mk("fankick"),
            mk("linkgrupo"),
            mk("restpro"),
          ],
        },
        {
          title: "🔓 ABRIR / CERRAR GRUPO",
          highlight_label: "LOCK",
          rows: [
            mk("abrir"),
            mk("cerrar"),
            mk("abrirgrupo"),
            mk("cerrargrupo"),
          ],
        },
      ],
    },
  ];

  // ====== ENVIAR ======
  if (usarBotones) {
    try {
      // Video/GIF + caption completo + botón del menú
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
      // Si falla, cae al modo manual
    }
  }

  // ====== MODO MANUAL (botones OFF o fallback) ======
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
