// comandos/letra.js — Lyrics Search (simple: manda la letra y ya)

const axios = require("axios");

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000;

function chunkText(text, max = 3500) {
  const s = String(text || "");
  if (s.length <= max) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
}

async function getLyricsFromSky(text) {
  const { data: res, status: http } = await axios.post(
    `${API_BASE}/tools/lyrics`,
    { text },
    {
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: MAX_TIMEOUT,
      validateStatus: (s) => s >= 200 && s < 600,
    }
  );

  if (http !== 200) throw new Error(`HTTP ${http}${res?.message ? ` - ${res.message}` : ""}`);
  if (!res || res.status !== true || !res.result?.lyrics) {
    throw new Error(res?.message || "Letra no encontrada.");
  }

  return res.result; // { artist,title,album,lyrics }
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const q = (args || []).join(" ").trim();
  const pref = (global.prefixes && global.prefixes[0]) || ".";

  if (!q) {
    return conn.sendMessage(chatId, {
      text:
`✳️ Usa:
${pref}${command} <canción / artista>
Ej: ${pref}${command} Yemil difícil amarte`
    }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "🎵", key: msg.key } });

    const r = await getLyricsFromSky(q);

    const title  = r.title  || "Unknown";
    const artist = r.artist || "Unknown";
    const album  = r.album  || "";

    const header =
`🎵 *${title}*
👤 *${artist}*${album ? `\n💿 *${album}*` : ""}

`;

    const parts = chunkText(String(r.lyrics || "").trim(), 3200);

    // 1er mensaje con header
    await conn.sendMessage(chatId, { text: header + (parts[0] || "—") }, { quoted: msg });

    // resto (si hay)
    for (let i = 1; i < parts.length; i++) {
      await conn.sendMessage(chatId, { text: parts[i] }, { quoted: msg });
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Error en letra:", err?.message || err);
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* ${err?.message || "No se pudo obtener la letra."}`
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["letra", "lyrics"];
handler.help = ["letra <texto>"];
handler.tags = ["tools"];
handler.register = true;

module.exports = handler;
