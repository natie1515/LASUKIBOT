const fs = require("fs");
const path = require("path");

const handler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  const pref = global.prefixes?.[0] || ".";

  try { await conn.sendMessage2(chatId, { react: { text: "✨", key: msg.key } }, msg); } catch {}

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

  const caption = `╔════════════════╗
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
│๛ ${pref}welcome on/off
│๛ ${pref}despedidas on/off
│๛ ${pref}modoadmins on/off
│๛ ${pref}antilink on/off
│๛ ${pref}linkall on/off
│๛ ${pref}antis on/off
│๛ ${pref}antidelete on/off
│๛ ${pref}antiarabe on/off
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

  await conn.sendMessage2(
    chatId,
    {
      video: { url: "https://cdn.russellxz.click/29906d1e.mp4" },
      gifPlayback: true,
      caption
    },
    msg
  );
};

handler.command = ["menugrupo", "grupomenu"];
handler.help = ["menugrupo"];
handler.tags = ["menu"];

module.exports = handler;
