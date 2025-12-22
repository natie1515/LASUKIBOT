
// comandos/groq.js — AI (Groq) (SkyUltraPlus API)
// ✅ Lee texto en: res.result.result
// ✅ system opcional:  groq system: ... | prompt...
// ✅ Branding: La Suki Bot + API Link
// ✅ Extra: groqclear (limpia memoria del endpoint /ai/clear)

"use strict";

const axios = require("axios");

const API_BASE = (process.env.API_BASE || "https://api-sky.ultraplus.click").replace(/\/+$/, "");
const API_KEY  = process.env.API_KEY  || "Russellxz";
const MAX_TIMEOUT = 60000;

// --- Helpers ---
function pickTextFromApi(res) {
  // Tu endpoint: res.success({ prompt, result: "TEXTO", ... })
  // Respuesta típica de tu API: { status:true, result:{ prompt, result, model, ... } }
  const r = res?.result ?? res?.data ?? null;

  // ✅ Principal (tu caso)
  const t1 = r?.result;

  // compat por si algún proxy/handler cambia estructura
  const t2 = res?.result?.result;
  const t3 = res?.data?.result?.result;
  const t4 = res?.data?.result;
  const t5 = res?.result;

  const text = t1 ?? t2 ?? t3 ?? t4 ?? t5;
  return (typeof text === "string" ? text : "")?.trim();
}

async function askGroqSky(prompt, system) {
  const payload = { prompt };
  if (system) payload.system = system;

  const { data, status: http } = await axios.post(
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
    throw new Error(`HTTP ${http}${data?.message ? ` - ${data.message}` : ""}`);
  }
  if (!data || data.status !== true) {
    throw new Error(data?.message || "La API no respondió correctamente.");
  }

  const text = pickTextFromApi(data);
  if (!text) throw new Error("La API respondió pero no trajo texto.");

  // info útil por si quieres mostrarla
  const meta = data.result || {};
  return {
    text,
    model: meta.model || "llama-3.3-70b-versatile",
    memory: meta.memory_messages ?? null,
  };
}

// --- Handler principal ---
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

🧹 Limpiar memoria:
${pref}groqclear

🤖 𝗕𝗼𝘁: La Suki Bot
🔗 𝗔𝗣𝗜: ${API_BASE}`
    }, { quoted: msg });
  }

  // Permite: system: ... | prompt...
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

    const r = await askGroqSky(prompt, system);

    const header =
`🤖 *GROQ AI*
━━━━━━━━━━━━━━━━
🧠 *Modelo:* ${r.model}
${system ? `⚙️ *System:* ${system}\n` : ""}📝 *Prompt:* ${prompt}
${r.memory != null ? `🗂️ *Memoria:* ${r.memory} msgs\n` : ""}

🚀 *Powered by:* SkyUltraPlus API
🔗 ${API_BASE}/ai
🤖 *Bot:* La Suki Bot
━━━━━━━━━━━━━━━━
`;

    // WhatsApp se pone pendejo con textos enormes -> chunk
    const MAX_CHUNK = 3500;
    const full = header + r.text;

    if (full.length <= MAX_CHUNK) {
      await conn.sendMessage(chatId, { text: full }, { quoted: msg });
    } else {
      await conn.sendMessage(chatId, { text: header }, { quoted: msg });
      for (let i = 0; i < r.text.length; i += MAX_CHUNK) {
        await conn.sendMessage(chatId, { text: r.text.slice(i, i + MAX_CHUNK) }, { quoted: msg });
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

// --- Comando extra: limpiar memoria ---
async function clearGroqMem() {
  const { data, status: http } = await axios.post(
    `${API_BASE}/ai/clear`,
    {},
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

  if (http !== 200) throw new Error(`HTTP ${http}`);
  if (!data || data.status !== true) throw new Error(data?.message || "No se pudo limpiar memoria.");
  return true;
}

const clearHandler = async (msg, { conn }) => {
  const chatId = msg.key.remoteJid;
  try {
    await conn.sendMessage(chatId, { react: { text: "🧹", key: msg.key } });
    await clearGroqMem();
    await conn.sendMessage(chatId, {
      text:
`🧹 *Memoria borrada*
Ahora la IA empieza limpio.

🤖 𝗕𝗼𝘁: La Suki Bot
🔗 𝗔𝗣𝗜: ${API_BASE}`
    }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
  } catch (e) {
    await conn.sendMessage(chatId, { text: `❌ Error: ${e?.message || e}` }, { quoted: msg });
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
  }
};

// exports / metadata
handler.command = ["groq"];
handler.help = ["groq <mensaje>", "groq system: <system> | <mensaje>"];
handler.tags = ["tools"];
handler.register = true;

// segundo comando en el mismo archivo (si tu loader soporta 2 exports, NO)
// si tu loader solo soporta 1, pon groqclear en otro archivo.
// Aquí lo dejo como propiedad extra para loaders que lo aceptan:
handler.subcommands = [
  {
    command: ["groqclear"],
    help: ["groqclear"],
    tags: ["tools"],
    register: true,
    handler: clearHandler
  }
];

module.exports = handler;
