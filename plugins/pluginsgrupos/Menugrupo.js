// plugins/menugrupo.js — Menú de Grupo con Botones
// Si botones están ON: envía el video/imagen + menú desplegable con todos los comandos
// Si botones están OFF: envía el menú clásico en texto (modo manual)
// Al tocar un comando del menú: el usuario lo recibe con el prefijo actual
// Los on/off están duplicados (welcome on, welcome off, etc.) para activar rápido

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

  // Si hay config personalizada, se usa y se respeta (sin botones)
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

  // ====== CAPTION ======
  const captionBotones = `╔════════════════╗
     💠 𝙱𝙸𝙴𝙽𝚅𝙴𝙽𝙸𝙳𝙾 💠
╚════════════════╝
*𝐴𝑙 𝑚𝑒𝑛𝑢 𝑑𝑒 𝑔𝑟𝑢𝑝𝑜 𝑑𝑒 𝐿𝑎 𝑆𝑢𝑘𝑖 𝐵𝑜𝑡*

━━━━━━━━━━━━━━━━━━━━
🎯 *CÓMO USAR EL MENÚ*
━━━━━━━━━━━━━━━━━━━━

Toca el botón *📋 Menú de grupo* abajo del mensaje. Se abrirá la lista completa con todas las opciones de configuración y administración. Al tocar una, se enviará automáticamente el comando con el prefijo actual.

━━━━━━━━━━━━━━━━━━━━
🤖 *La Suki Bot — Panel de Grupo*
━━━━━━━━━━━━━━━━━━━━`.trim();

  const captionManual = `╔════════════════╗
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
│๛ ${pref}addco — agregar comando a Stickerz
│๛ ${pref}delco — eliminar comando en stickerz
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
│๛ ${pref}abrir — automáticamente
│๛ ${pref}cerrar — automáticamente
│๛ ${pref}abrirgrupo
│๛ ${pref}cerrargrupo
╰─────◆

🤖 *La Suki Bot — Panel de control grupal*`.trim();

  // ====== CONSTRUIR MENÚ DE BOTONES ======
  const nativeFlowButtons = [
    {
      text: "📋 Menú de grupo",
      sections: [
        {
          title: "🛠️ CONFIGURACIONES",
          highlight_label: "SETUP",
          rows: [
            { header: "", title: `${pref}infogrupo`,       description: "Ver información del grupo",          id: `${pref}infogrupo`       },
            { header: "", title: `${pref}setinfo`,         description: "Cambiar la descripción del grupo",   id: `${pref}setinfo`         },
            { header: "", title: `${pref}setname`,         description: "Cambiar el nombre del grupo",        id: `${pref}setname`         },
            { header: "", title: `${pref}setfoto`,         description: "Cambiar la foto del grupo",          id: `${pref}setfoto`         },
            { header: "", title: `${pref}setwelcome`,      description: "Configurar mensaje de bienvenida",   id: `${pref}setwelcome`      },
            { header: "", title: `${pref}setdespedidas`,   description: "Configurar mensaje de despedida",    id: `${pref}setdespedidas`   },
            { header: "", title: `${pref}setreglas`,       description: "Configurar las reglas del grupo",    id: `${pref}setreglas`       },
            { header: "", title: `${pref}reglas`,          description: "Mostrar las reglas",                 id: `${pref}reglas`          },
            { header: "", title: `${pref}configrupo`,      description: "Ver configuración del grupo",       id: `${pref}configrupo`      },
            { header: "", title: `${pref}addco`,           description: "Agregar comando a stickers",         id: `${pref}addco`           },
            { header: "", title: `${pref}delco`,           description: "Eliminar comando de stickers",       id: `${pref}delco`           },
          ],
        },
        {
          title: "✅ ACTIVAR FUNCIONES",
          highlight_label: "ON",
          rows: [
            { header: "", title: `${pref}welcome on`,      description: "Activar bienvenidas automáticas",    id: `${pref}welcome on`      },
            { header: "", title: `${pref}despedidas on`,   description: "Activar despedidas automáticas",     id: `${pref}despedidas on`   },
            { header: "", title: `${pref}modoadmins on`,   description: "Solo admins pueden usar el bot",     id: `${pref}modoadmins on`   },
            { header: "", title: `${pref}antilink on`,     description: "Bloquear enlaces en el grupo",       id: `${pref}antilink on`     },
            { header: "", title: `${pref}linkall on`,      description: "Permitir todo tipo de enlaces",      id: `${pref}linkall on`      },
            { header: "", title: `${pref}antis on`,        description: "Activar antisticker",                id: `${pref}antis on`        },
            { header: "", title: `${pref}antidelete on`,   description: "Recuperar mensajes borrados",        id: `${pref}antidelete on`   },
            { header: "", title: `${pref}antiarabe on`,    description: "Bloquear caracteres árabes",         id: `${pref}antiarabe on`    },
          ],
        },
        {
          title: "❌ DESACTIVAR FUNCIONES",
          highlight_label: "OFF",
          rows: [
            { header: "", title: `${pref}welcome off`,     description: "Desactivar bienvenidas",             id: `${pref}welcome off`     },
            { header: "", title: `${pref}despedidas off`,  description: "Desactivar despedidas",              id: `${pref}despedidas off`  },
            { header: "", title: `${pref}modoadmins off`,  description: "Todos pueden usar el bot",           id: `${pref}modoadmins off`  },
            { header: "", title: `${pref}antilink off`,    description: "Desactivar antilink",                id: `${pref}antilink off`    },
            { header: "", title: `${pref}linkall off`,     description: "Bloquear todos los enlaces",         id: `${pref}linkall off`     },
            { header: "", title: `${pref}antis off`,       description: "Desactivar antisticker",             id: `${pref}antis off`       },
            { header: "", title: `${pref}antidelete off`,  description: "Desactivar recuperador",             id: `${pref}antidelete off`  },
            { header: "", title: `${pref}antiarabe off`,   description: "Desactivar filtro de árabe",         id: `${pref}antiarabe off`   },
          ],
        },
        {
          title: "🛡️ ADMINISTRACIÓN",
          highlight_label: "ADMIN",
          rows: [
            { header: "", title: `${pref}daradmins`,       description: "Dar permisos de admin",              id: `${pref}daradmins`       },
            { header: "", title: `${pref}quitaradmins`,    description: "Quitar permisos de admin",           id: `${pref}quitaradmins`    },
            { header: "", title: `${pref}kick`,            description: "Expulsar a un miembro",              id: `${pref}kick`            },
            { header: "", title: `${pref}ban`,             description: "Banear a un miembro",                id: `${pref}ban`             },
            { header: "", title: `${pref}unban`,           description: "Desbanear a un miembro",             id: `${pref}unban`           },
            { header: "", title: `${pref}mute`,            description: "Silenciar a un miembro",             id: `${pref}mute`            },
            { header: "", title: `${pref}unmute`,          description: "Quitar silencio",                    id: `${pref}unmute`          },
            { header: "", title: `${pref}delete`,          description: "Borrar mensaje citado",              id: `${pref}delete`          },
          ],
        },
        {
          title: "👥 ETIQUETAR",
          highlight_label: "TAG",
          rows: [
            { header: "", title: `${pref}tag`,             description: "Etiquetar con mensaje",              id: `${pref}tag`             },
            { header: "", title: `${pref}tagall`,          description: "Etiquetar a todos visible",          id: `${pref}tagall`          },
            { header: "", title: `${pref}todos`,           description: "Mencionar a todos",                  id: `${pref}todos`           },
            { header: "", title: `${pref}invocar`,         description: "Invocar a miembros",                 id: `${pref}invocar`         },
            { header: "", title: `${pref}totalchat`,       description: "Total de mensajes del chat",         id: `${pref}totalchat`       },
            { header: "", title: `${pref}restchat`,        description: "Reset de estadísticas",              id: `${pref}restchat`        },
            { header: "", title: `${pref}fantasmas`,       description: "Ver miembros inactivos",             id: `${pref}fantasmas`       },
            { header: "", title: `${pref}fankick`,         description: "Expulsar a inactivos",               id: `${pref}fankick`         },
            { header: "", title: `${pref}linkgrupo`,       description: "Obtener link del grupo",             id: `${pref}linkgrupo`       },
            { header: "", title: `${pref}restpro`,         description: "Reset del grupo (pro)",              id: `${pref}restpro`         },
          ],
        },
        {
          title: "🔓 ABRIR / CERRAR GRUPO",
          highlight_label: "LOCK",
          rows: [
            { header: "", title: `${pref}abrir`,           description: "Abrir grupo automáticamente",        id: `${pref}abrir`           },
            { header: "", title: `${pref}cerrar`,          description: "Cerrar grupo automáticamente",       id: `${pref}cerrar`          },
            { header: "", title: `${pref}abrirgrupo`,      description: "Abrir grupo ahora",                  id: `${pref}abrirgrupo`      },
            { header: "", title: `${pref}cerrargrupo`,     description: "Cerrar grupo ahora",                 id: `${pref}cerrargrupo`     },
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
          caption: captionBotones,
          footer: "❦ La Suki Bot — Panel de Grupo ❦",
          buttons: nativeFlowButtons,
          headerType: 4,
        },
        msg
      );
      return;
    } catch (e) {
      console.log("[menugrupo] menú nativo falló, fallback a texto:", e.message);
      // Si falla, cae al modo manual
    }
  }

  // ====== MODO MANUAL (botones OFF o fallback) ======
  await conn.sendMessage2(
    chatId,
    {
      video: { url: "https://cdn.russellxz.click/29906d1e.mp4" },
      gifPlayback: true,
      caption: captionManual,
    },
    msg
  );
};

handler.command = ["menugrupo", "grupomenu"];
handler.help = ["menugrupo"];
handler.tags = ["menu"];

module.exports = handler;
