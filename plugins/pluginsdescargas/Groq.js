// comandos/groq.js — AI (GROQ) chat simple
// ✅ Envía prompt y system (opcional)
// ✅ Responde SOLO texto (sin archivos)
// ✅ Branding: La Suki Bot + SkyUltraPlus API

"use strict";

const axios = require("axios");

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000; // 60s

async function askGroqSky(prompt, system) {
  const payload = { prompt };
  if (system) payload.system = system;

  const { data: res, status: http } = await axios.post(
    `${API_BASE}/ai`,
    payload,
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

  if (http !== 200) {
    throw new Error(`HTTP ${http}${res?.message ? ` - ${res.message}` : ""}`);
  }

  if (!res || res.status !== true) {
    throw new Error(res?.message || "La API no respondió correctamente.");
  }

  // Soporta varias estructuras posibles
  const r = res.result ?? res.data ?? res;
  const text =
    r?.text ??
    r?.message ??
    r?.reply ??
    r?.response ??
    r?.output ??
    r?.content ??
    (typeof r === "string" ? r : "");

  if (!text || !String(text).trim()) {
    throw new Error("La API respondió pero no trajo texto.");
  }

  return String(text).trim();
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  const pref   = (global.prefixes && global.prefixes[0]) || ".";

  const input = (args || []).join(" ").trim();
  if (!input) {
    return conn.sendMessage(chatId, {
      text:
`✳️ 𝙐𝙨𝙖:
${pref}${command || "groq"} <mensaje>

Opcional (system):
${pref}${command || "groq"} system: eres un asistente serio | hola, quien eres?

🤖 Bot: La Suki Bot
🔗 API: ${API_BASE}`
    }, { quoted: msg });
  }

  // Permite "system: ... | prompt..."
  let system = "";
  let prompt = input;

  const m = input.match(/^system\s*:\s*([\s\S]+?)\s*\|\s*([\s\S]+)$/i);
  if (m) {
    system = (m[1] || "").trim();
    prompt = (m[2] || "").trim();
  }

  if (!prompt) {
    return conn.sendMessage(chatId, { text: "❌ Escribe un mensaje para enviar a la IA." }, { quoted: msg });
  }

  try {
    await conn.sendMessage(chatId, { react: { text: "🤖", key: msg.key } });

    const reply = await askGroqSky(prompt, system);

    const head =
`🤖 *GROQ AI*
━━━━━━━━━━━━━━━━
🧠 *Modelo:* Groq (SkyUltraPlus)
${system ? `⚙️ *System:* ${system}\n` : ""}📝 *Prompt:* ${prompt}

🚀 *Powered by:* SkyUltraPlus API
🔗 ${API_BASE}/ai
🤖 *Bot:* La Suki Bot

`;

    // WhatsApp corta textos largos: chunk seguro
    const MAX_CHUNK = 3500;
    const out = head + reply;

    if (out.length <= MAX_CHUNK) {
      await conn.sendMessage(chatId, { text: out }, { quoted: msg });
    } else {
      // 1) Header
      await conn.sendMessage(chatId, { text: head }, { quoted: msg });

      // 2) Respuesta en partes
      for (let i = 0; i < reply.length; i += MAX_CHUNK) {
        await conn.sendMessage(chatId, { text: reply.slice(i, i + MAX_CHUNK) }, { quoted: msg });
      }
    }

    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (err) {
    console.error("❌ Error en groq:", err?.message || err);
    await conn.sendMessage(chatId, {
      text: `❌ *Error:* ${err?.message || "No pude obtener respuesta de la IA."}`
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

handler.command = ["groq"];
handler.help = ["groq <mensaje>", "groq system: <system> | <mensaje>"];
handler.tags = ["tools"];
handler.register = true;

module.exports = handler;
