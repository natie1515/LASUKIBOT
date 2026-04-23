let canalId = ["120363266665814365@newsletter"];  
let canalNombre = ["👑 LA SUKI BOT 👑"]
  function setupConnection(conn) {
  conn.sendMessage2 = async (chat, content, m, options = {}) => {
    const firstChannel = { 
      id: canalId[0], 
      nombre: canalNombre[0] 
    };
    if (content.sticker) {
      return conn.sendMessage(chat, { 
        sticker: content.sticker 
      }, { 
        quoted: m,
        ...options 
      });
    }
    const messageOptions = {
      ...content,
      mentions: content.mentions || options.mentions || [],
      contextInfo: {
        ...(content.contextInfo || {}),
        forwardedNewsletterMessageInfo: {
          newsletterJid: firstChannel.id,
          serverMessageId: '',
          newsletterName: firstChannel.nombre
        },
        forwardingScore: 9999999,
        isForwarded: true,
        mentionedJid: content.mentions || options.mentions || []
      }
    };

    return conn.sendMessage(chat, messageOptions, {
      quoted: m,
      ephemeralExpiration: 86400000,
      disappearingMessagesInChat: 86400000,
      ...options
    });
  };
  }



// (sin los require de Baileys aquí)
const { readdirSync } = require("fs");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const figlet = require("figlet");
const readline = require("readline");
const pino = require("pino");
const { setConfig, getConfig } = require("./db");

// 🌐 Prefijos personalizados desde prefijos.json o por defecto
let defaultPrefixes = [".", "#"];
const prefixPath = "./prefijos.json";
global.requireFromRoot = (mod) => require(path.join(__dirname, mod));
if (fs.existsSync(prefixPath)) {
  try {
    const contenido = fs.readFileSync(prefixPath, "utf-8").trim();
    const parsed = JSON.parse(contenido);
    if (Array.isArray(parsed)) {
      defaultPrefixes = parsed;
    } else if (typeof parsed === "string") {
      defaultPrefixes = [parsed];
    }
  } catch {}
}
global.prefixes = defaultPrefixes;

// 🧑‍💼 Owners desde owner.json
const ownerPath = "./owner.json";
if (!fs.existsSync(ownerPath)) fs.writeFileSync(ownerPath, JSON.stringify([["15167096032"]], null, 2));
global.owner = JSON.parse(fs.readFileSync(ownerPath));

// 📂 Cargar plugins
const loadPluginsRecursively = (dir) => {
  if (!fs.existsSync(dir)) return;

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      loadPluginsRecursively(fullPath); // Recurse en subcarpetas
    } else if (item.isFile() && item.name.endsWith(".js")) {
      try {
        const plugin = require(path.resolve(fullPath));
        global.plugins.push(plugin);
        console.log(chalk.green(`✅ Plugin cargado: ${fullPath}`));
      } catch (err) {
        console.log(chalk.red(`❌ Error al cargar ${fullPath}: ${err}`));
      }
    }
  }
};

// 👉 Cargar todos los .js dentro de ./plugins y subcarpetas
global.plugins = [];
loadPluginsRecursively("./plugins");

// 🎯 Función global para verificar si es owner
global.isOwner = function (jid) {
  const num = jid.replace(/[^0-9]/g, "");
  return global.owner.some(([id]) => id === num);
};

// 🎨 Banner y opciones
console.log(chalk.cyan(figlet.textSync("Suki 3.0 Bot", { font: "Standard" })));
console.log(chalk.green("\n✅ Iniciando conexión...\n"));
console.log(chalk.green("  [Hola] ") + chalk.white("🔑 Ingresar Tu Numero(Ej: 54911XXXXXX)\n"));

// 📞 Entrada de usuario
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

let method = "1";
let phoneNumber = "";

(async () => {
  // ✅ Import dinámico compatible con CJS (6.x) y ESM (futuro 7.x)
  const mod = await import('@whiskeysockets/baileys');
  // Si es CJS, `mod.default` es el objeto de exports; si es ESM, usamos `mod` directo
  const B = mod.default && Object.keys(mod).length === 1 ? mod.default : mod;

  const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    fetchLatestWaWebVersion,    // puede existir solo en versiones nuevas
    fetchLatestBaileysVersion,  // existe en 6.x
    downloadContentFromMessage
  } = B;

  // Función de versión compatible (usa la nueva si existe; si no, la vieja)
  const getWaVersion = typeof fetchLatestWaWebVersion === "function"
    ? fetchLatestWaWebVersion
    : fetchLatestBaileysVersion;

  const { state, saveCreds } = await useMultiFileAuthState("./sessions");

  if (!fs.existsSync("./sessions/creds.json")) {
    method = await question(chalk.magenta("📞(VAMOS AYA😎): "));
    phoneNumber = method.replace(/\D/g, "");
    if (!phoneNumber) {
      console.log(chalk.red("\n❌ Número inválido."));
      process.exit(1);
    }
    method = "2";
  }

  async function startBot() {
    try {
      // ✅ usa la función de versión disponible en tu Baileys
      const { version } = await getWaVersion();

      const sock = makeWASocket({ 
        version,
        logger: pino({ level: "silent" }),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        browser: method === "1" ? ["AzuraBot", "Safari", "1.0.0"] : ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: method === "1",
      });

      // ⬇️⬇️ **INYECCIÓN WA PARA TODOS LOS PLUGINS** ⬇️⬇️
      global.wa = { downloadContentFromMessage };
      // por comodidad, también accesible como conn.wa
      sock.wa = global.wa;
      // ⬆️⬆️------------------------------------------------ ⬆️⬆️

      setupConnection(sock);

      // 🔧 Normaliza participants: si id es @lid y existe .jid (real), reemplaza por el real
      sock.lidParser = function (participants = []) {
        try {
          return participants.map(v => ({
            ...v,
            id: (typeof v?.id === "string" && v.id.endsWith("@lid") && v.jid)
              ? v.jid
              : v.id
          }));
        } catch (e) {
          console.error("[lidParser] error:", e);
          return participants || [];
        }
      };

      // 🧠 Ejecutar plugins con eventos especiales como bienvenida
      for (const plugin of global.plugins) {
        if (typeof plugin.run === "function") {
          try {
            // Pasamos wa como segundo argumento opcional (no rompe nada si el plugin no lo usa)
            plugin.run(sock, { wa: global.wa });
            console.log(chalk.magenta("🧠 Plugin con eventos conectado"));
          } catch (e) {
            console.error(chalk.red("❌ Error al ejecutar evento del plugin:"), e);
          }
        }
      }
      
      if (!fs.existsSync("./sessions/creds.json") && method === "2") {
        setTimeout(async () => {
          const code = await sock.requestPairingCode(phoneNumber);
          console.log(chalk.magenta("🔑 Código de vinculación: ") + chalk.yellow(code.match(/.{1,4}/g).join("-")));
        }, 2000);
      }



      
      // 💬 Manejo de mensajes

sock.ev.on("messages.upsert", async ({ messages }) => {
  const m = messages[0];
  if (!m || !m.message) return;

  // 🔎 Normalización PROFUNDA: convierte LIDs a números reales en TODO el mensaje,
  // incluyendo chats PRIVADOS (consulta al signalRepository cuando hace falta).
  await (async () => {
    const DIGITS = (s = "") => (s || "").replace(/\D/g, "");
    const isUser = (j) => typeof j === "string" && j.endsWith("@s.whatsapp.net");
    const isLid  = (j) => typeof j === "string" && j.endsWith("@lid");

    // 🧠 Mapa global LID ↔ PN (se va llenando con cada mensaje)
    global.lidMap = global.lidMap || new Map();

    // 🔄 Resolver LID → PN (usa mapa local primero, luego consulta a Baileys)
    const toRealJid = async (jid) => {
      if (!jid || typeof jid !== "string") return jid;
      if (isUser(jid)) return jid;                         // ya es PN real
      if (!isLid(jid)) return jid;                         // no es LID, devolver tal cual

      // 1) Buscar en mapa local
      if (global.lidMap.has(jid)) return global.lidMap.get(jid);

      // 2) Intentar resolver con signalRepository (Baileys v7+)
      try {
        if (sock.signalRepository?.lidMapping?.getPNForLID) {
          const pn = await sock.signalRepository.lidMapping.getPNForLID(jid);
          if (pn && isUser(pn)) {
            global.lidMap.set(jid, pn);   // cachear para futuras llamadas
            global.lidMap.set(pn, jid);
            return pn;
          }
        }
      } catch {}

      // 3) No se pudo resolver, dejar el LID tal cual
      return jid;
    };

    // Versión sincrónica para campos donde no podemos usar await
    // (usa solo el mapa local, sin consultar a WhatsApp)
    const toRealJidSync = (jid) => {
      if (!jid || typeof jid !== "string") return jid;
      if (isUser(jid)) return jid;
      if (isLid(jid) && global.lidMap.has(jid)) return global.lidMap.get(jid);
      return jid;
    };

    // ========= PASO 1: Identificar el PN real del autor del mensaje =========
    // Prioridad 1: Campos PN explícitos (Baileys v6.8+/v7+ los trae en grupos)
    const altPn =
      (isUser(m.key?.senderPn)        && m.key.senderPn) ||
      (isUser(m.key?.participantPn)   && m.key.participantPn) ||
      (isUser(m.key?.senderAlt)       && m.key.senderAlt) ||
      (isUser(m.key?.participantAlt)  && m.key.participantAlt) ||
      null;

    // Prioridad 2: Campos legacy (forks custom)
    const legacy =
      (isUser(m.key?.jid)         && m.key.jid) ||
      (isUser(m.key?.participant) && m.key.participant) ||
      (m.key?.remoteJid && !m.key.remoteJid.endsWith("@g.us") && isUser(m.key.remoteJid) && m.key.remoteJid) ||
      null;

    let realJidOfSender = altPn || legacy;

    // Capturar el LID del autor
    const lidOfSender =
      (isLid(m.key?.senderLid)       && m.key.senderLid) ||
      (isLid(m.key?.participantLid)  && m.key.participantLid) ||
      (isLid(m.key?.participant)     && m.key.participant) ||
      (isLid(m.key?.remoteJid)       && m.key.remoteJid) ||
      null;

    // 🆕 PRIVADOS: si no tenemos PN pero SÍ tenemos un LID, consultar a Baileys
    if (!realJidOfSender && lidOfSender) {
      const resolved = await toRealJid(lidOfSender);
      if (resolved && isUser(resolved)) {
        realJidOfSender = resolved;
      }
    }

    // ========= PASO 2: Guardar el mapeo LID ↔ PN =========
    if (realJidOfSender && lidOfSender) {
      global.lidMap.set(lidOfSender, realJidOfSender);
      global.lidMap.set(realJidOfSender, lidOfSender);
    }

    // ========= PASO 3: Sobrescribir los campos del mensaje =========
    if (realJidOfSender) {
      m.key.jid = realJidOfSender;
      m.key.participant = realJidOfSender;
      m.realJid = realJidOfSender;
      m.realNumber = DIGITS(realJidOfSender);
      m.realLid = lidOfSender;
    } else if (lidOfSender) {
      m.realJid = lidOfSender;
      m.realNumber = DIGITS(lidOfSender);
      m.realLid = lidOfSender;
    } else {
      m.realJid = null;
      m.realNumber = null;
      m.realLid = null;
    }

    // ========= PASO 4: Normalizar el remoteJid si es LID en chat privado =========
    if (m.key?.remoteJid && isLid(m.key.remoteJid) && realJidOfSender) {
      m.key.remoteJid = realJidOfSender;
    }

    // ========= PASO 5: Normalizar el contextInfo =========
    const ctx =
      m.message?.extendedTextMessage?.contextInfo ||
      m.message?.imageMessage?.contextInfo ||
      m.message?.videoMessage?.contextInfo ||
      m.message?.documentMessage?.contextInfo ||
      m.message?.audioMessage?.contextInfo ||
      m.message?.stickerMessage?.contextInfo ||
      null;

    if (ctx) {
      // Participant del mensaje citado (cuando responden a alguien)
      if (ctx.participant) {
        ctx.participant = await toRealJid(ctx.participant);
      }
      if (ctx.participantPn && isUser(ctx.participantPn)) {
        ctx.participant = ctx.participantPn;
      }

      // remoteJid del contexto
      if (ctx.remoteJid && isLid(ctx.remoteJid)) {
        ctx.remoteJid = await toRealJid(ctx.remoteJid);
      }

      // Menciones con @ (usa versión sincrónica porque es array)
      if (Array.isArray(ctx.mentionedJid)) {
        ctx.mentionedJid = ctx.mentionedJid.map(toRealJidSync);
      }

      // Grupos mencionados
      if (Array.isArray(ctx.groupMentions)) {
        ctx.groupMentions = ctx.groupMentions.map((g) => {
          if (g && g.groupJid) g.groupJid = toRealJidSync(g.groupJid);
          return g;
        });
      }
    }

    // ========= PASO 6: Exponer helpers globales =========
    global.resolveRealJid = toRealJidSync;
    global.resolveRealJidAsync = toRealJid;
    global.resolveRealNumber = (jid) => DIGITS(toRealJidSync(jid) || "");
  })();

  global.mActual = m; // debug opcional

  const chatId = m.key.remoteJid;
  const sender = m.key.participant || m.key.remoteJid; // participant ya viene normalizado al real
  const fromMe = m.key.fromMe || sender === sock.user.id;
  const isGroup = chatId.endsWith("@g.us");

  let messageContent =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";


  console.log(chalk.yellow(`\n📩 Nuevo mensaje recibido`));
  console.log(chalk.green(`📨 De: ${fromMe ? "[Tú]" : "[Usuario]"} ${chalk.bold(sender)}`));
  console.log(chalk.cyan(`💬 Tipo: ${Object.keys(m.message)[0]}`));
  console.log(chalk.cyan(`💬 Texto: ${chalk.bold(messageContent || "📂 (Multimedia)")}`));



/* === STICKER → COMANDO (GLOBAL) usando ./comandos.json — para Suki === */
try {
  const st =
    m.message?.stickerMessage ||
    m.message?.ephemeralMessage?.message?.stickerMessage ||
    null;

  if (st && fs.existsSync("./comandos.json")) {
    // 1) Generar CLAVES posibles para el sticker (base64 y "126,67,...")
    const rawSha = st.fileSha256 || st.fileSha256Hash || st.filehash;
    const candidates = [];

    if (rawSha) {
      if (Buffer.isBuffer(rawSha)) {
        candidates.push(rawSha.toString("base64"));              // base64 (Buffer)
        candidates.push(Array.from(rawSha).toString());          // "126,67,..."
      } else if (ArrayBuffer.isView(rawSha)) { // Uint8Array, etc.
        const buf = Buffer.from(rawSha);
        candidates.push(buf.toString("base64"));
        candidates.push(Array.from(rawSha).toString());
      } else if (typeof rawSha === "string") {
        candidates.push(rawSha); // ya viene como string
      }
    }

    // 2) Buscar comando en ./comandos.json probando todas las claves
    let mapped = null;
    const map = JSON.parse(fs.readFileSync("./comandos.json", "utf-8") || "{}") || {};
    for (const k of candidates) {
      if (k && typeof map[k] === "string" && map[k].trim()) {
        mapped = map[k].trim();
        break;
      }
    }

    if (mapped) {
      // 3) Asegurar prefijo si el comando se guardó sin prefijo
      const ensurePrefixed = (t) => {
        const pref = (Array.isArray(global.prefixes) && global.prefixes[0]) || ".";
        return (Array.isArray(global.prefixes) && global.prefixes.some(p => t.startsWith(p)))
          ? t
          : (pref + t);
      };
      const injectedText = ensurePrefixed(mapped);

      // 4) Inyectar el "texto" del comando en el mensaje
      //    (agregamos extendedTextMessage PERO conservamos stickerMessage para que otras lógicas sigan viéndolo como sticker)
      const ctx = st.contextInfo || {};
      m.message.extendedTextMessage = {
        text: injectedText,
        contextInfo: {
          quotedMessage: ctx.quotedMessage || null,
          participant: ctx.participant || null,
          stanzaId: ctx.stanzaId || "",
          remoteJid: ctx.remoteJid || m.key.remoteJid,
          mentionedJid: Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : []
        }
      };

      // 5) Actualizar el buffer de texto que usa el parser de comandos
      messageContent = injectedText;

      // (Opcional) marcas de depuración
      m._stickerCmdInjected = true;
      m._stickerCmdText = injectedText;
    }
  }
} catch (e) {
  console.error("❌ Sticker→cmd error:", e);
}
/* === FIN STICKER → COMANDO === */

  
// === 🤖 INICIO LÓGICA IA NATURAL (SUKI / BOT) + AUDIO PTT ===
// Se activa cuando alguien menciona "suki" o "bot" en cualquier parte del mensaje
// (como palabra separada, no dentro de otras palabras como "sukiyaki" o "robot").
// Ignora mensajes con prefijo de comando (.suki, #bot, etc).
// Mantiene historial de conversación por chat (últimos 10 mensajes) inyectándolo en el prompt.
// Descarga el MP3 de la API y lo convierte a OGG/Opus con ffmpeg para que WhatsApp lo reproduzca como nota de voz.
// Si el audio falla, cae en fallback y envía texto normal.
try {
  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const fromMe = m.key.fromMe;

  const textoIA = (
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    ""
  ).trim();

  const tienePrefijo = textoIA && global.prefixes.some(p => textoIA.startsWith(p));

  if (!fromMe && textoIA && !tienePrefijo) {
    // 🎯 Detecta "suki" o "bot" como palabra separada (no dentro de otras)
    const regexSuki = /\b(suki|bot)\b/i;

    if (regexSuki.test(textoIA)) {
      // 🚦 Anti-spam: mínimo 3 segundos entre respuestas al mismo usuario
      global._sukiIACooldown = global._sukiIACooldown || {};
      const cdKey = `${chatId}:${senderId}`;
      const lastTime = global._sukiIACooldown[cdKey] || 0;
      const now = Date.now();

      if (now - lastTime >= 3000) {
        global._sukiIACooldown[cdKey] = now;

        // 💾 Historial por chat (últimos 10 mensajes)
        global._sukiIAHist = global._sukiIAHist || {};
        if (!Array.isArray(global._sukiIAHist[chatId])) {
          global._sukiIAHist[chatId] = [];
        }

        (async () => {
          const fsLocal = require("fs");
          const pathLocal = require("path");
          const CryptoLocal = require("crypto");
          const ffmpegLocal = require("fluent-ffmpeg");

          const tmpDir = pathLocal.resolve("./tmp");
          if (!fsLocal.existsSync(tmpDir)) fsLocal.mkdirSync(tmpDir, { recursive: true });

          const rid = CryptoLocal.randomBytes(6).toString("hex");
          const mp3Path = pathLocal.join(tmpDir, `suki_${rid}.mp3`);
          const oggPath = pathLocal.join(tmpDir, `suki_${rid}.ogg`);

          try {
            try { await sock.sendPresenceUpdate("composing", chatId); } catch {}

            const axios = require("axios");
            const API_KEY = "mk-668eddd56d17442cec5c740c2f4471e3a547d197a760717f";

            // 📚 Armar el "prompt" con el historial reciente para mantener contexto
            // (el endpoint /api/ia es de consulta rápida con prompt único)
            const historialPrev = global._sukiIAHist[chatId].slice(-10);
            let promptCompleto = "";
            if (historialPrev.length > 0) {
              promptCompleto += "Conversación previa:\n";
              for (const msg of historialPrev) {
                const rol = msg.role === "user" ? "Usuario" : "Suki";
                promptCompleto += `${rol}: ${msg.content}\n`;
              }
              promptCompleto += `\nUsuario: ${textoIA}`;
            } else {
              promptCompleto = textoIA;
            }

            const systemPrompt = "Eres Suki, una asistente de WhatsApp amigable, divertida y natural. Respondes en español, con mensajes cortos y claros (máximo 2-3 oraciones). Nunca digas que eres una IA ni menciones tu modelo. Actúa como una amiga cercana.";

            // 🧠 Llamada a /api/ia con prompt + system
            const chatRes = await axios.post(
              "https://devmatrixs.lat/api/ia",
              {
                model: "minimax",
                prompt: promptCompleto,
                system: systemPrompt
              },
              {
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": API_KEY
                },
                timeout: 30000,
                validateStatus: () => true
              }
            );

            const cd = chatRes.data || {};
            const respuestaTexto = (
              cd?.respuesta ||
              cd?.reply ||
              cd?.response ||
              cd?.message ||
              cd?.content ||
              cd?.result ||
              cd?.text ||
              cd?.data?.respuesta ||
              cd?.data?.reply ||
              cd?.data?.response ||
              cd?.data?.message ||
              cd?.data?.content ||
              cd?.choices?.[0]?.message?.content ||
              ""
            ).toString().trim();

            if (!respuestaTexto) {
              try { await sock.sendPresenceUpdate("paused", chatId); } catch {}
              console.log("[SukiIA] ⚠️ Respuesta vacía:", JSON.stringify(cd).slice(0, 300));
              return;
            }

            // 💾 Guardar en historial
            global._sukiIAHist[chatId].push({ role: "user", content: textoIA });
            global._sukiIAHist[chatId].push({ role: "assistant", content: respuestaTexto });
            if (global._sukiIAHist[chatId].length > 10) {
              global._sukiIAHist[chatId] = global._sukiIAHist[chatId].slice(-10);
            }

            // Reaccionar
            try {
              await sock.sendMessage(chatId, { react: { text: "💬", key: m.key } });
            } catch {}

            // Cambiar presencia a "grabando audio"
            try { await sock.sendPresenceUpdate("recording", chatId); } catch {}

            // 🎤 Pedir URL del audio a /api/audio con voz nova
            const textoParaAudio = respuestaTexto.slice(0, 500);
            let audioUrl = "";

            try {
              const audioRes = await axios.get(
                "https://devmatrixs.lat/api/audio",
                {
                  params: {
                    text: textoParaAudio,
                    voice: "nova"
                  },
                  headers: {
                    "x-api-key": API_KEY
                  },
                  timeout: 30000,
                  validateStatus: () => true
                }
              );

              const ad = audioRes.data || {};
              audioUrl = ad?.url || ad?.data?.url || ad?.audio || ad?.data?.audio || "";
            } catch (audioErr) {
              console.log("[SukiIA] ⚠️ Error obteniendo URL del audio:", audioErr.message);
            }

            if (audioUrl) {
              try {
                // 1) Descargar el MP3
                const audioFile = await axios.get(audioUrl, {
                  responseType: "arraybuffer",
                  timeout: 30000
                });
                const mp3Buffer = Buffer.from(audioFile.data);
                fsLocal.writeFileSync(mp3Path, mp3Buffer);

                // 2) Convertir MP3 → OGG/Opus (formato correcto para PTT de WhatsApp)
                await new Promise((resolve, reject) => {
                  ffmpegLocal(mp3Path)
                    .audioCodec("libopus")
                    .audioChannels(1)
                    .audioFrequency(48000)
                    .audioBitrate("64k")
                    .outputOptions([
                      "-avoid_negative_ts", "make_zero",
                      "-application", "voip"
                    ])
                    .format("ogg")
                    .on("end", resolve)
                    .on("error", reject)
                    .save(oggPath);
                });

                // 3) Leer el OGG y enviarlo como nota de voz
                const oggBuffer = fsLocal.readFileSync(oggPath);

                try { await sock.sendPresenceUpdate("paused", chatId); } catch {}

                await sock.sendMessage(
                  chatId,
                  {
                    audio: oggBuffer,
                    mimetype: "audio/ogg; codecs=opus",
                    ptt: true
                  },
                  { quoted: m }
                );

                // Limpiar archivos temporales
                try { fsLocal.unlinkSync(mp3Path); } catch {}
                try { fsLocal.unlinkSync(oggPath); } catch {}
                return; // ✅ Audio enviado correctamente

              } catch (convErr) {
                console.log("[SukiIA] ⚠️ Error convirtiendo audio, envío texto:", convErr.message);
                try { fsLocal.unlinkSync(mp3Path); } catch {}
                try { fsLocal.unlinkSync(oggPath); } catch {}
              }
            }

            try { await sock.sendPresenceUpdate("paused", chatId); } catch {}

            // 📝 Fallback: si el audio falla, enviar texto
            await sock.sendMessage(
              chatId,
              { text: respuestaTexto },
              { quoted: m }
            );

          } catch (err) {
            console.error("[SukiIA] ❌ Error general:", err.message);
            try { await sock.sendPresenceUpdate("paused", chatId); } catch {}
            try { fsLocal.unlinkSync(mp3Path); } catch {}
            try { fsLocal.unlinkSync(oggPath); } catch {}
          }
        })();
      }
    }
  }
} catch (e) {
  console.error("❌ Error en lógica IA natural (SukiIA):", e);
}
// === 🤖 FIN LÓGICA IA NATURAL ===
              
            

  
  //fin de la logica modo admins         
// ——— Presentación automática (solo una vez por grupo) ———
  if (isGroup) {
    const welcomePath = path.resolve("setwelcome.json");
    // Asegurarnos de que existe y cargar
    if (!fs.existsSync(welcomePath)) fs.writeFileSync(welcomePath, "{}");
    const welcomeData = JSON.parse(fs.readFileSync(welcomePath, "utf-8"));

    welcomeData[chatId] = welcomeData[chatId] || {};
    if (!welcomeData[chatId].presentationSent) {
      // Enviar vídeo de presentación
      await sock.sendMessage(chatId, {
        video: { url: "https://cdn.russellxz.click/bc06f25b.mp4" },
        caption: `
🎉 ¡Hola a todos! 🎉

👋 Soy *La Suki Bot*, un bot programado 🤖.  
📸 A veces reacciono o envío multimedia porque así me diseñaron.  

⚠️ *Lo que diga no debe ser tomado en serio.* 😉

📌 Usa el comando *.menu* o *.menugrupo* para ver cómo usarme y programar cosas.  
Soy un bot *sencillo y fácil de usar*, ¡gracias por tenerme en el grupo! 💖  
        `.trim()
      });
      // Marcar como enviado y guardar
      welcomeData[chatId].presentationSent = true;
      fs.writeFileSync(welcomePath, JSON.stringify(welcomeData, null, 2));
    }
  }
  //fin de la logica
  
// === INICIO LÓGICA CHATGPT POR GRUPO CON activos.db ===
try {
  const { getConfig } = requireFromRoot("db");
  const isGroup = m.key.remoteJid.endsWith("@g.us");
  const chatId = m.key.remoteJid;
  const fromMe = m.key.fromMe;

  const chatgptActivo = await getConfig(chatId, "chatgpt");

  const messageText = m.message?.conversation ||
                      m.message?.extendedTextMessage?.text ||
                      m.message?.imageMessage?.caption ||
                      m.message?.videoMessage?.caption || "";

  if (isGroup && chatgptActivo == 1 && !fromMe && messageText.length > 0) {
    const encodedText = encodeURIComponent(messageText);
    const sessionID = "1727468410446638";
    const apiUrl = `https://api.neoxr.eu/api/gpt4-session?q=${encodedText}&session=${sessionID}&apikey=russellxz`;

    const axios = require("axios");
    const res = await axios.get(apiUrl);
    const respuesta = res.data?.data?.message;

    if (respuesta) {
      await sock.sendMessage(chatId, {
        text: respuesta
      }, { quoted: m });
    }
  }
} catch (e) {
  console.error("❌ Error en lógica ChatGPT por grupo:", e);
}
// === FIN LÓGICA CHATGPT POR GRUPO CON activos.db ===
// === LÓGICA DE RESPUESTA AUTOMÁTICA CON PALABRA CLAVE (híbrida: carpeta + base64) ===
try {
  const guarPath = path.resolve('./guar.json');        // viejo (base64)
  const guarFilesPath = path.resolve('./guar_files.json'); // nuevo (rutas)

  // Cargar base de datos COMBINADA (viejo + nuevo)
  let guarData = {};

  // 1) Cargar el viejo (base64). Si el archivo es enorme y falla el parseo, lo ignoramos.
  if (fs.existsSync(guarPath)) {
    try {
      guarData = JSON.parse(fs.readFileSync(guarPath, 'utf-8'));
    } catch {
      guarData = {};
    }
  }

  // 2) Cargar el nuevo (rutas) y combinar con el viejo
  if (fs.existsSync(guarFilesPath)) {
    try {
      const filesDb = JSON.parse(fs.readFileSync(guarFilesPath, 'utf-8'));
      for (const k of Object.keys(filesDb)) {
        if (!Array.isArray(guarData[k])) guarData[k] = [];
        guarData[k] = guarData[k].concat(filesDb[k]);
      }
    } catch {}
  }

  if (Object.keys(guarData).length > 0) {
    const cleanText = messageContent
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w]/g, '');

    for (const key of Object.keys(guarData)) {
      const cleanKey = key
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w]/g, '');

      if (cleanText === cleanKey && guarData[key]?.length) {
        const item = guarData[key][Math.floor(Math.random() * guarData[key].length)];

        // Obtener el buffer: primero archivo físico, si no existe usa base64
        let buffer = null;

        if (item.path) {
          try {
            const filePath = path.resolve(item.path);
            if (fs.existsSync(filePath)) {
              buffer = fs.readFileSync(filePath);
            }
          } catch {}
        }

        if (!buffer && item.media) {
          try {
            buffer = Buffer.from(item.media, "base64");
          } catch {}
        }

        if (!buffer || !buffer.length) return;

        const extension = item.ext || item.mime?.split("/")[1] || "bin";
        const mime = item.mime || "";

        const options = { quoted: m };
        let payload = {};

        if (["jpg", "jpeg", "png"].includes(extension)) {
          payload.image = buffer;
        } else if (["mp4", "mkv", "webm"].includes(extension)) {
          payload.video = buffer;
        } else if (["mp3", "ogg", "opus"].includes(extension)) {
          payload.audio = buffer;
          payload.mimetype = mime || "audio/mpeg";
          payload.ptt = false;
        } else if (["webp"].includes(extension)) {
          payload.sticker = buffer;
        } else {
          payload.document = buffer;
          payload.mimetype = mime || "application/octet-stream";
          payload.fileName = item.fileName || `archivo.${extension}`;
        }

        await sock.sendMessage(chatId, payload, options);
        return;
      }
    }
  }
} catch (e) {
  console.error("❌ Error en lógica de palabra clave:", e);
}
// === FIN DE LÓGICA ===

  
// === ⛔ INICIO LÓGICA ANTIS STICKERS (bloqueo tras 3 strikes en 15s) ===
try {
  const chatId = m.key.remoteJid;
  const fromMe = m.key.fromMe;
  const isGroup = chatId.endsWith("@g.us");
  const stickerMsg = m.message?.stickerMessage || m.message?.ephemeralMessage?.message?.stickerMessage;

  if (isGroup && !fromMe && stickerMsg) {
    const { getConfig } = requireFromRoot("db");
    const antisActivo = await getConfig(chatId, "antis");

    if (antisActivo == 1) {
      const user = m.key.participant || m.key.remoteJid;
      const now = Date.now();

      if (!global.antisSpam) global.antisSpam = {};
      if (!global.antisSpam[chatId]) global.antisSpam[chatId] = {};
      if (!global.antisBlackList) global.antisBlackList = {};

      const userData = global.antisSpam[chatId][user] || {
        count: 0,
        last: now,
        warned: false,
        strikes: 0
      };

      const timePassed = now - userData.last;

      if (timePassed > 15000) {
        userData.count = 1;
        userData.last = now;
        userData.warned = false;
        userData.strikes = 0;

        if (global.antisBlackList[chatId]?.includes(user)) {
          global.antisBlackList[chatId] = global.antisBlackList[chatId].filter(u => u !== user);
        }
      } else {
        userData.count++;
        userData.last = now;
      }

      global.antisSpam[chatId][user] = userData;

      if (userData.count === 5) {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${user.split("@")[0]} has enviado *5 stickers*. Espera *15 segundos* o si envías *3 más*, serás eliminado.`,
          mentions: [user]
        });
        userData.warned = true;
        userData.strikes = 0;
      }

      if (userData.count > 5 && timePassed < 15000) {
        if (!global.antisBlackList[chatId]) global.antisBlackList[chatId] = [];
        if (!global.antisBlackList[chatId].includes(user)) {
          global.antisBlackList[chatId].push(user);
        }

        await sock.sendMessage(chatId, {
          delete: {
            remoteJid: chatId,
            fromMe: false,
            id: m.key.id,
            participant: user
          }
        });

        userData.strikes++;

        if (userData.strikes >= 3) {
          await sock.sendMessage(chatId, {
            text: `❌ @${user.split("@")[0]} fue eliminado por ignorar advertencias y abusar de stickers.`,
            mentions: [user]
          });
          await sock.groupParticipantsUpdate(chatId, [user], "remove");
          delete global.antisSpam[chatId][user];
        }
      }

      global.antisSpam[chatId][user] = userData;
    }
  }
} catch (e) {
  console.error("❌ Error en lógica antis stickers:", e);
}
// === ✅ FIN LÓGICA ANTIS STICKERS ===

  
  // === ✅ INICIO CONTEO DE MENSAJES EN setwelcome.json ===
try {
  const fs = require("fs");
  const path = require("path");

  const welcomePath = path.resolve("setwelcome.json");
  if (!fs.existsSync(welcomePath)) {
    fs.writeFileSync(welcomePath, JSON.stringify({}, null, 2));
  }

  const welcomeData = JSON.parse(fs.readFileSync(welcomePath, "utf-8"));

  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const fromMe = m.key.fromMe;
  const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net";

  if (isGroup) {
    welcomeData[chatId] = welcomeData[chatId] || {};
    welcomeData[chatId].chatCount = welcomeData[chatId].chatCount || {};

    const quien = fromMe ? botNumber : senderId;
    welcomeData[chatId].chatCount[quien] = (welcomeData[chatId].chatCount[quien] || 0) + 1;

    fs.writeFileSync(welcomePath, JSON.stringify(welcomeData, null, 2));
  }
} catch (e) {
  console.error("❌ Error en conteo de mensajes en setwelcome.json:", e);
}
// === ✅ FIN CONTEO DE MENSAJES EN setwelcome.json ===
  
// === ⛔ INICIO GUARDADO ANTIDELETE (con activos.db y antidelete.db) ===
try {
  const isGroup = chatId.endsWith("@g.us");

  const { getConfig, getAntideleteDB, saveAntideleteDB } = requireFromRoot("db");
  const antideleteGroupActive = isGroup ? await getConfig(chatId, "antidelete") == 1 : false;
  const antideletePrivActive = !isGroup ? await getConfig("global", "antideletepri") == 1 : false;

  if (antideleteGroupActive || antideletePrivActive) {
    const idMsg = m.key.id;
    const botNumber = sock.user.id.split(":")[0] + "@s.whatsapp.net";
    const senderId = m.key.participant || (m.key.fromMe ? botNumber : m.key.remoteJid);
    const type = Object.keys(m.message || {})[0];
    const content = m.message[type];

    // ❌ No guardar si es view once
    if (type === "viewOnceMessageV2") return;

    // ❌ No guardar si supera 10MB
    if (
      ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type) &&
      content.fileLength > 10 * 1024 * 1024
    ) return;

    // Objeto base
    const guardado = {
      chatId,
      sender: senderId,
      type,
      timestamp: Date.now()
    };

    // Función para guardar multimedia en base64
    const saveBase64 = async (mediaType, data) => {
      const stream = await downloadContentFromMessage(data, mediaType);
      let buffer = Buffer.alloc(0);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      guardado.media = buffer.toString("base64");
      guardado.mimetype = data.mimetype;
    };

    // ✅ CORREGIDO: Usamos await para asegurarnos que se termine de guardar
    if (["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].includes(type)) {
      const mediaType = type.replace("Message", "");
      await saveBase64(mediaType, content); // 👈 ESTE await es clave
    }

    // Texto
    if (type === "conversation" || type === "extendedTextMessage") {
      guardado.text = m.message.conversation || m.message.extendedTextMessage?.text || "";
    }

    // Guardar en antidelete.db
    const db = getAntideleteDB();
    const scope = isGroup ? "g" : "p";
    db[scope][idMsg] = guardado;
    saveAntideleteDB(db);
  }
} catch (e) {
  console.error("❌ Error en lógica ANTIDELETE:", e);
}
// === ✅ FIN GUARDADO ANTIDELETE ===
// === INICIO DETECCIÓN DE MENSAJE ELIMINADO ===
if (m.message?.protocolMessage?.type === 0) {
  try {
    const deletedId = m.message.protocolMessage.key.id;
    const whoDeleted = m.message.protocolMessage.key.participant || m.key.participant || m.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const senderNumber = (whoDeleted || '').replace(/[^0-9]/g, '');
    const mentionTag = [`${senderNumber}@s.whatsapp.net`];

    const antideleteEnabled = isGroup
  ? (await getConfig(chatId, "antidelete")) === "1"
  : (await getConfig("global", "antideletepri")) === "1";

    if (!antideleteEnabled) return;

    const fs = require("fs");
    const dbPath = "./antidelete.db";

    if (!fs.existsSync(dbPath)) return;

    const db = JSON.parse(fs.readFileSync(dbPath));
    const tipo = isGroup ? "g" : "p";
    const data = db[tipo] || {};
    const deletedData = data[deletedId];
    if (!deletedData) return;

    const senderClean = (deletedData.sender || '').replace(/[^0-9]/g, '');
    if (senderClean !== senderNumber) return;

    if (isGroup) {
      try {
        const meta = await sock.groupMetadata(chatId);
        const isAdmin = meta.participants.find(p => p.id === `${senderNumber}@s.whatsapp.net`)?.admin;
        if (isAdmin) return;
      } catch (e) {
        console.error("❌ Error leyendo metadata:", e);
        return;
      }
    }

    const type = deletedData.type;
    const mimetype = deletedData.mimetype || 'application/octet-stream';
    const buffer = deletedData.media ? Buffer.from(deletedData.media, "base64") : null;

    if (buffer) {
      const sendOpts = {
        [type.replace("Message", "")]: buffer,
        mimetype,
        quoted: m
      };

      if (type === "stickerMessage") {
        const sent = await sock.sendMessage(chatId, sendOpts);
        await sock.sendMessage(chatId, {
          text: `📌 El sticker fue eliminado por @${senderNumber}`,
          mentions: mentionTag,
          quoted: sent
        });
      } else if (type === "audioMessage") {
        const sent = await sock.sendMessage(chatId, sendOpts);
        await sock.sendMessage(chatId, {
          text: `🎧 El audio fue eliminado por @${senderNumber}`,
          mentions: mentionTag,
          quoted: sent
        });
      } else {
        sendOpts.caption = `📦 Mensaje eliminado por @${senderNumber}`;
        sendOpts.mentions = mentionTag;
        await sock.sendMessage(chatId, sendOpts, { quoted: m });
      }

    } else if (deletedData.text) {
      await sock.sendMessage(chatId, {
        text: `📝 *Mensaje eliminado:* ${deletedData.text}\n👤 *Usuario:* @${senderNumber}`,
        mentions: mentionTag
      }, { quoted: m });
    }

  } catch (err) {
    console.error("❌ Error en lógica antidelete:", err);
  }
}
// === FIN DETECCIÓN DE MENSAJE ELIMINADO ===

  
// 🔗 LÓGICA ANTILINK desde activos.db (compatible LID y NO-LID)
try {
  const antilinkState = await getConfig(chatId, "antilink");
  if (isGroup && parseInt(antilinkState) === 1) {
    const texto = (messageContent || "").toLowerCase();
    const invitaWA = /https?:\/\/chat\.whatsapp\.com\//i.test(texto);

    if (invitaWA) {
      const DIGITS = (s = "") => String(s).replace(/\D/g, "");

      // Autor (preferimos el REAL normalizado arriba en tu handler)
      const senderRealJid = m.realJid || (sender?.endsWith?.("@s.whatsapp.net") ? sender : null);
      const senderNum     = m.realNumber || DIGITS(senderRealJid || sender);
      const mentionId     = senderRealJid || `${senderNum}@s.whatsapp.net`;

      // Owner por número real
      const isOwnerHere = (typeof isOwner === "function")
        ? isOwner(senderNum)
        : (Array.isArray(global.owner) && global.owner.some(([id]) => id === senderNum));

      // Admin por número (resolviendo LID -> real con lidParser)
      let isAdmin = false;
      try {
        const meta  = await sock.groupMetadata(chatId);
        const raw   = Array.isArray(meta?.participants) ? meta.participants : [];
        const parts = typeof sock.lidParser === "function" ? sock.lidParser(raw) : raw;

        const adminNums = new Set();
        for (let i = 0; i < raw.length; i++) {
          const r = raw[i], n = parts[i];
          const flag = (r?.admin === "admin" || r?.admin === "superadmin" ||
                        n?.admin === "admin" || n?.admin === "superadmin");
          if (flag) {
            [r?.id, r?.jid, n?.id].forEach(x => {
              const d = DIGITS(x);
              if (d) adminNums.add(d);
            });
          }
        }
        isAdmin = adminNums.has(senderNum);
      } catch (e) {
        console.error("[ANTILINK] ❌ metadata:", e);
      }

      // Permisos: bot / owner / admin → no actuar
      if (fromMe || isOwnerHere || isAdmin) {
        console.log("[ANTILINK] ⚠️ Usuario con permisos; se omite.");
        return;
      }

      // Eliminar el mensaje con invitación
      await sock.sendMessage(chatId, { delete: m.key });
      console.log("[ANTILINK] 🧹 Mensaje eliminado por invitación de WhatsApp.");

      // Advertencias por número real
      const fs = require("fs");
      const advPath = "./advertencias.json";
      if (!fs.existsSync(advPath)) fs.writeFileSync(advPath, JSON.stringify({}));

      const advertencias = JSON.parse(fs.readFileSync(advPath, "utf-8"));
      advertencias[chatId] = advertencias[chatId] || {};
      advertencias[chatId][senderNum] = (advertencias[chatId][senderNum] || 0) + 1;

      const total = advertencias[chatId][senderNum];
      fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));

      if (total >= 3) {
        // Expulsión al 3/3 — usar realJid si existe; si no, el id original (puede ser @lid)
        await sock.sendMessage(chatId, {
          text: `❌ @${senderNum} fue eliminado por enviar enlaces prohibidos (3/3).`,
          mentions: [mentionId]
        });
        try {
          await sock.groupParticipantsUpdate(chatId, [senderRealJid || sender], "remove");
        } catch (e) {
          console.error("[ANTILINK] ❌ Error al expulsar:", e);
        }

        advertencias[chatId][senderNum] = 0;
        fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));
      } else {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${senderNum}, enviar invitaciones de WhatsApp no está permitido aquí.\nAdvertencia: ${total}/3.`,
          mentions: [mentionId]
        });
      }
    }
  }
} catch (e) {
  console.error("❌ Error final en lógica ANTILINK:", e);
}
// === FIN LÓGICA ANTILINK ===

// === LÓGICA LINKALL DESDE activos.db (compatible LID y NO-LID) ===
try {
  const estadoLinkAll = await getConfig(chatId, "linkall");
  if (isGroup && parseInt(estadoLinkAll) === 1) {
    const texto = (messageContent || "").toLowerCase();

    // Detecta cualquier link que NO sea invitación de grupo de WhatsApp
    const contieneLink    = /(https?:\/\/[^\s]+)/i.test(texto);
    const esWhatsAppGroup = /https?:\/\/chat\.whatsapp\.com\//i.test(texto);

    if (contieneLink && !esWhatsAppGroup) {
      const DIGITS = (s="") => String(s).replace(/\D/g,"");

      // Autor (preferimos real si ya lo normalizaste arriba)
      const senderRealJid = m.realJid || (sender?.endsWith?.("@s.whatsapp.net") ? sender : null);
      const senderNum     = m.realNumber || DIGITS(senderRealJid || sender);
      const mentionId     = senderRealJid || `${senderNum}@s.whatsapp.net`;

      // ¿Es owner?
      const isOwnerHere = (typeof isOwner === "function")
        ? isOwner(senderNum)
        : (Array.isArray(global.owner) && global.owner.some(([id]) => id === senderNum));

      // ¿Es admin? (resolviendo LID -> número real)
      let isAdmin = false;
      try {
        const meta  = await sock.groupMetadata(chatId);
        const raw   = Array.isArray(meta?.participants) ? meta.participants : [];
        const parts = typeof sock.lidParser === "function" ? sock.lidParser(raw) : raw;

        const adminNums = new Set();
        for (let i = 0; i < raw.length; i++) {
          const r = raw[i], n = parts[i];
          const flag = (r?.admin === "admin" || r?.admin === "superadmin" ||
                        n?.admin === "admin" || n?.admin === "superadmin");
          if (flag) {
            [r?.id, r?.jid, n?.id].forEach(x => {
              const d = DIGITS(x);
              if (d) adminNums.add(d);
            });
          }
        }
        isAdmin = adminNums.has(senderNum);
      } catch (e) {
        console.error("[LINKALL] ❌ Error leyendo metadata:", e);
      }

      // Permisos: bot / owner / admin -> no actuar
      if (fromMe || isOwnerHere || isAdmin) {
        console.log("[LINKALL] ⚠️ Usuario con permisos; se omite.");
        return;
      }

      // Eliminar mensaje
      await sock.sendMessage(chatId, { delete: m.key });
      console.log("[LINKALL] 🔥 Mensaje eliminado por link no permitido.");

      // Advertencias por usuario (key por número real)
      const fs = require("fs");
      const advPath = "./advertencias.json";
      if (!fs.existsSync(advPath)) fs.writeFileSync(advPath, JSON.stringify({}));

      const advertencias = JSON.parse(fs.readFileSync(advPath, "utf-8"));
      advertencias[chatId] = advertencias[chatId] || {};
      advertencias[chatId][senderNum] = (advertencias[chatId][senderNum] || 0) + 1;

      const advertenciasTotales = advertencias[chatId][senderNum];
      fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));

      if (advertenciasTotales >= 10) {
        await sock.sendMessage(chatId, {
          text: `❌ @${senderNum} fue eliminado por enviar enlaces prohibidos (10/10).`,
          mentions: [mentionId]
        });
        try {
          // Expulsar: usar REAL si lo tenemos; si no, el id original (puede ser @lid)
          await sock.groupParticipantsUpdate(chatId, [senderRealJid || sender], "remove");
        } catch (e) {
          console.error("[LINKALL] ❌ Error al expulsar:", e);
        }
        advertencias[chatId][senderNum] = 0;
        fs.writeFileSync(advPath, JSON.stringify(advertencias, null, 2));
      } else {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${senderNum}, no se permiten enlaces externos.\nAdvertencia: ${advertenciasTotales}/10.`,
          mentions: [mentionId]
        });
      }
    }
  }
} catch (e) {
  console.error("❌ Error final en lógica LINKALL:", e);
}
// === FIN DE LINKALL ===
// === INICIO BLOQUEO DE MENSAJES DE USUARIOS MUTEADOS ===
try {
  const fs = require("fs");
  const path = require("path");
  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isGroup = chatId.endsWith("@g.us");
  const isBot = senderId === sock.user.id;
  const isOwner = global.isOwner(senderId);

  if (isGroup && !isOwner) {
    const welcomePath = path.resolve("setwelcome.json");
    const welcomeData = fs.existsSync(welcomePath)
      ? JSON.parse(fs.readFileSync(welcomePath, "utf-8"))
      : {};

    const mutedList = welcomeData[chatId]?.muted || [];

    if (mutedList.includes(senderId)) {
      global._muteCounter = global._muteCounter || {};
      const key = `${chatId}:${senderId}`;
      global._muteCounter[key] = (global._muteCounter[key] || 0) + 1;

      const count = global._muteCounter[key];

      if (count === 8) {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${senderNum}, estás *muteado*. Si sigues enviando mensajes podrías ser eliminado.`,
          mentions: [senderId]
        });
      }

      if (count === 13) {
        await sock.sendMessage(chatId, {
          text: `⛔ @${senderNum}, estás al *límite*. Un mensaje más y serás eliminado.`,
          mentions: [senderId]
        });
      }

      if (count >= 15) {
        const metadata = await sock.groupMetadata(chatId);
        const isAdmin = metadata.participants.find(p => p.id === senderId)?.admin;

        if (!isAdmin) {
          await sock.groupParticipantsUpdate(chatId, [senderId], "remove");
          await sock.sendMessage(chatId, {
            text: `❌ @${senderNum} fue eliminado por ignorar el mute.`,
            mentions: [senderId]
          });
          delete global._muteCounter[key];
        } else {
          await sock.sendMessage(chatId, {
            text: `🔇 @${senderNum} está muteado pero no puede ser eliminado por ser admin.`,
            mentions: [senderId]
          });
        }
      }

      await sock.sendMessage(chatId, {
        delete: {
          remoteJid: chatId,
          fromMe: false,
          id: m.key.id,
          participant: senderId
        }
      });

      return;
    }
  }
} catch (err) {
  console.error("❌ Error en lógica de muteo:", err);
}
// === FIN BLOQUEO DE MENSAJES DE USUARIOS MUTEADOS ===
// === INICIO BLOQUEO DE COMANDOS A USUARIOS BANEADOS ===
try {
  const fs = require("fs");
  const path = require("path");

  const welcomePath = path.resolve("./setwelcome.json");
  const welcomeData = fs.existsSync(welcomePath) ? JSON.parse(fs.readFileSync(welcomePath)) : {};

  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isFromMe = m.key.fromMe;
  const isOwner = global.isOwner(senderId);

  const messageText =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";

  // ✅ Verifica si el mensaje comienza con algún prefijo válido
  const prefixUsed = global.prefixes.find((p) => messageText?.startsWith(p));
  if (!prefixUsed) return;

  const chatBanList = welcomeData[chatId]?.banned || [];

  if (chatBanList.includes(senderId) && !isOwner && !isFromMe) {
    const frases = [
      "🚫 @usuario estás baneado por pendejo. ¡Abusaste demasiado del bot!",
      "❌ Lo siento @usuario, pero tú ya no puedes usarme. Aprende a comportarte.",
      "🔒 No tienes permiso @usuario. Fuiste baneado por molestar mucho.",
      "👎 ¡Bloqueado! @usuario abusaste del sistema y ahora no puedes usarme.",
      "😤 Quisiste usarme pero estás baneado, @usuario. Vuelve en otra vida."
    ];

    const texto = frases[Math.floor(Math.random() * frases.length)].replace("@usuario", `@${senderNum}`);

    await sock.sendMessage(chatId, {
      text: texto,
      mentions: [senderId]
    }, { quoted: m });

    return; // ❌ Evita que el comando continúe
  }
} catch (e) {
  console.error("❌ Error procesando bloqueo de usuarios baneados:", e);
}
// === FIN BLOQUEO DE COMANDOS A USUARIOS BANEADOS ===





  
// === 🔐 INICIO MODO PRIVADO GLOBAL ===
try {
  const chatId = m.key.remoteJid;
  const isGroup = chatId.endsWith("@g.us");
  const botJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";

  const senderId = isGroup
    ? m.key.participant
    : m.key.fromMe
      ? botJid
      : chatId;

  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isBot = senderId === botJid;
  const isOwner = global.owner.some(([id]) => id === senderNum);

  const { getConfig } = requireFromRoot("db");
  const modoPrivado = await getConfig("global", "modoprivado");

  if (parseInt(modoPrivado) === 1) {
    const fs = require("fs");
    const path = require("path");
    const welcomePath = path.resolve("setwelcome.json");
    const welcomeData = fs.existsSync(welcomePath)
      ? JSON.parse(fs.readFileSync(welcomePath, "utf-8"))
      : {};
    const whitelist = welcomeData.lista || [];
    const jid = `${senderNum}@s.whatsapp.net`;
    const permitido = isOwner || isBot || whitelist.includes(jid);

    if (!permitido) return;
  }
} catch (e) {
  console.error("❌ Error en lógica de modo privado:", e);
}
// === 🔐 FIN MODO PRIVADO GLOBAL ===


  
// === ✅ INICIO LÓGICA DE APAGADO POR GRUPO (solo responde al dueño) ===
try {
  const { getConfig } = requireFromRoot("db");
  const fs = require("fs");

  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isGroup = chatId.endsWith("@g.us");
  const isOwner = global.owner.some(([id]) => id === senderNum);

  if (isGroup) {
    const apagado = await getConfig(chatId, "apagado");

    if (apagado == 1 && !isOwner) {
      return; // 👈 Si está apagado y no es owner, ignorar mensaje
    }
  }
} catch (e) {
  console.error("❌ Error en lógica de apagado por grupo:", e);
}
// === ✅ FIN LÓGICA DE APAGADO POR GRUPO ===  
// === INICIO BLOQUEO DE COMANDOS RESTRINGIDOS POR GRUPO ===
try {
  const fs = require("fs");
  const path = require("path");

  const chatId = m.key.remoteJid;
  const senderId = m.key.participant || m.key.remoteJid;
  const senderNum = senderId.replace(/[^0-9]/g, "");
  const isOwner = global.isOwner(senderId);
  const isBot = senderId === sock.user.id;
  const isFromMe = m.key.fromMe;

  const messageText =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    "";

  const prefixUsed = global.prefixes.find(p => messageText.startsWith(p));
  if (!prefixUsed) return;

  const command = messageText.slice(prefixUsed.length).trim().split(" ")[0].toLowerCase();

  const welcomePath = path.resolve("setwelcome.json");
  const welcomeData = fs.existsSync(welcomePath)
    ? JSON.parse(fs.readFileSync(welcomePath, "utf-8"))
    : {};

  const restringidos = welcomeData[chatId]?.restringidos || [];

  if (restringidos.includes(command)) {
    if (!isOwner && !isFromMe && !isBot) {
      global.reintentosRestrict = global.reintentosRestrict || {};
      const key = `${chatId}:${senderId}:${command}`;
      global.reintentosRestrict[key] = (global.reintentosRestrict[key] || 0) + 1;

      const intentos = global.reintentosRestrict[key];

      if (intentos <= 2) {
        await sock.sendMessage(chatId, {
          text: `🚫 *Este comando está restringido en este grupo.*\nSolo el *dueño del bot* y el *bot* pueden usarlo.`,
          quoted: m
        });
      }

      if (intentos === 3) {
        await sock.sendMessage(chatId, {
          text: `⚠️ @${senderNum} *este es tu intento 3* usando un comando restringido.\n💥 Si lo haces *una vez más*, serás *ignorado para este comando*.`,
          mentions: [senderId],
          quoted: m
        });
      }

      if (intentos >= 4) {
        console.log(`🔇 Ignorando a ${senderId} para el comando restringido: ${command}`);
        return;
      }

      return; // ← cortar ejecución del comando
    }
  }
} catch (e) {
  console.error("❌ Error en lógica de comandos restringidos:", e);
}
// === FIN BLOQUEO DE COMANDOS RESTRINGIDOS POR GRUPO ===
// 🔐 VERIFICACIÓN MODOADMINS (compatible LID y NO-LID)
if (isGroup) {
  try {
    const estadoModoAdmins = await getConfig(chatId, "modoadmins"); // 👈 usa await
    if (parseInt(estadoModoAdmins) === 1) {

      // Preferimos el real que ya calculaste antes en el handler
      const senderNum = (m?.realNumber && String(m.realNumber)) ||
                        String(sender).replace(/[^0-9]/g, "");

      // Owner por número (estable)
      const isOwner = Array.isArray(global.owner) && global.owner.some(([id]) => id === senderNum);

      // ¿Es admin? -> por NÚMERO real, resolviendo LID con metadata
      let isAdmin = false;
      try {
        const meta = await sock.groupMetadata(chatId);
        const rawParts = Array.isArray(meta?.participants) ? meta.participants : [];

        // Normaliza ids: si algún participante viene @lid y trae .jid real, úsalo.
        const normParts = typeof sock.lidParser === "function" ? sock.lidParser(rawParts) : rawParts;

        // Construimos el conjunto de NÚMEROS de todos los admins (considerando id, jid y normalizado)
        const adminNums = new Set();
        for (let i = 0; i < rawParts.length; i++) {
          const r = rawParts[i];
          const n = normParts[i];
          const flagAdmin =
            (r?.admin === "admin" || r?.admin === "superadmin" ||
             n?.admin === "admin" || n?.admin === "superadmin");

          if (flagAdmin) {
            [r?.id, r?.jid, n?.id].forEach(x => {
              const d = String(x || "").replace(/\D/g, "");
              if (d) adminNums.add(d);
            });
          }
        }
        isAdmin = adminNums.has(senderNum);
      } catch (e) {
        console.error("[modoAdmins] error leyendo metadata:", e);
      }

      // Si NO es admin, ni owner, ni el bot -> ignorar mensaje
      if (!isAdmin && !isOwner && !fromMe) return;
    }
  } catch (e) {
    console.error("❌ Error verificando modoAdmins:", e);
    return;
  }
}  

  
  // 🧩 Detectar prefijo
  const prefixUsed = global.prefixes.find(p => messageContent.startsWith(p));
  if (!prefixUsed) return;
  
  const command = messageContent.slice(prefixUsed.length).trim().split(" ")[0].toLowerCase();
  const rawArgs = messageContent.trim().slice(prefixUsed.length + command.length).trim();
  const args = rawArgs.length ? rawArgs.split(/\s+/) : [];        
  // 🔁 Ejecutar comando desde plugins
  for (const plugin of global.plugins) {
    const isClassic = typeof plugin === "function";
    const isCompatible = plugin.command?.includes?.(command);

    try {
      if (isClassic && plugin.command?.includes?.(command)) {
        await plugin(m, { conn: sock, text: rawArgs, args, command }); // ← CAMBIO aquí
        break;
      }

      if (!isClassic && isCompatible) {
        await plugin.run({ msg: m, conn: sock, args, command });
        break;
      }
    } catch (e) {
      console.error(chalk.red(`❌ Error ejecutando ${command}:`), e);
    }
  }
});

sock.ev.on("connection.update", async ({ connection }) => {
  if (connection === "open") {
    console.log(chalk.green("✅ Conectado correctamente a WhatsApp."));

    // ✔️ Si fue reiniciado con .carga, avisar
    const restarterFile = "./lastRestarter.json";
    if (fs.existsSync(restarterFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(restarterFile, "utf-8"));
        if (data.chatId) {
          await sock.sendMessage(data.chatId, {
            text: "✅ *Suki Bot 3.0 está en línea nuevamente* 🚀"
          });
          console.log(chalk.yellow("📢 Aviso enviado al grupo del reinicio."));
          fs.unlinkSync(restarterFile); // 🧹 Eliminar archivo tras el aviso
        }
      } catch (error) {
        console.error("❌ Error leyendo lastRestarter.json:", error);
      }
    }

  } else if (connection === "close") {
    console.log(chalk.red("❌ Conexión cerrada. Reintentando en 5 segundos..."));
    setTimeout(startBot, 5000);
  }
});

      sock.ev.on("creds.update", saveCreds);

      process.on("uncaughtException", (err) => {
        console.error(chalk.red("⚠️ Error no capturado:"), err);
      });

      process.on("unhandledRejection", (reason, promise) => {
        console.error(chalk.red("🚨 Promesa sin manejar:"), promise, "Razón:", reason);
      });

    } catch (e) {
      console.error(chalk.red("❌ Error en conexión:"), e);
      setTimeout(startBot, 5000);
    }
  }

  startBot();
})();
