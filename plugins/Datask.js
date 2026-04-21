const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function unwrapMessage(m) {
  let node = m;
  while (
    node?.viewOnceMessage?.message ||
    node?.viewOnceMessageV2?.message ||
    node?.viewOnceMessageV2Extension?.message ||
    node?.ephemeralMessage?.message
  ) {
    node =
      node.viewOnceMessage?.message ||
      node.viewOnceMessageV2?.message ||
      node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message;
  }
  return node;
}

function ensureWA(wa, conn) {
  if (wa?.downloadContentFromMessage) return wa;
  if (conn?.wa?.downloadContentFromMessage) return conn.wa;
  if (global.wa?.downloadContentFromMessage) return global.wa;
  return null;
}

const handler = async (msg, { conn, wa }) => {

  const chatId = msg.key.remoteJid;

  const quotedRaw =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  if (!quotedRaw) {
    return conn.sendMessage(chatId, {
      text: "Responde a un sticker"
    }, { quoted: msg });
  }

  const q = unwrapMessage(quotedRaw);

  const stickerMsg = q?.stickerMessage || null;
  const docMsg = q?.documentMessage || null;

  if (!stickerMsg && !docMsg) {
    return conn.sendMessage(chatId, {
      text: "Eso no es un sticker"
    }, { quoted: msg });
  }

  await conn.sendMessage(chatId, {
    react: { text: "🔍", key: msg.key }
  }).catch(() => {});

  const tmpDir = path.join(__dirname, "../tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const base = Date.now();

  const inputPath = path.join(tmpDir, `${base}.bin`);
  const extractDir = path.join(tmpDir, `${base}_extract`);

  try {

    const WA = ensureWA(wa, conn);

    const node = stickerMsg ? stickerMsg : docMsg;

    const stream = await WA.downloadContentFromMessage(node, "sticker");

    let buffer = Buffer.alloc(0);

    for await (const chunk of stream)
      buffer = Buffer.concat([buffer, chunk]);

    fs.writeFileSync(inputPath, buffer);

    // detectar tipo real
    let fileType = "unknown";

    if (buffer.slice(0, 4).toString() === "PK\u0003\u0004") {
      fileType = "was";
    }
    else if (buffer.slice(8, 12).toString() === "WEBP") {
      fileType = "webp";
    }

    let report = {
      size: buffer.length,
      detectedType: fileType,
      files: []
    };

    if (fileType === "was") {

      fs.mkdirSync(extractDir, { recursive: true });

      execSync(`unzip "${inputPath}" -d "${extractDir}"`);

      const files = fs.readdirSync(extractDir, { recursive: true });

      report.files = files;

      // buscar json
      let jsonData = [];

      for (const file of files) {

        if (file.endsWith(".json")) {

          const full = path.join(extractDir, file);

          const json = JSON.parse(
            fs.readFileSync(full, "utf8")
          );

          jsonData.push({
            file,
            keys: Object.keys(json),
            assets: json.assets?.length || 0,
            layers: json.layers?.length || 0,
            fr: json.fr,
            ip: json.ip,
            op: json.op,
            w: json.w,
            h: json.h
          });

        }

      }

      report.jsonInfo = jsonData;

    }

    // enviar info
    await conn.sendMessage(chatId, {
      text:
`DATA STICKER

Tipo: ${report.detectedType}

Peso: ${report.size}

Archivos:
${JSON.stringify(report.files, null, 2)}

JSON:
${JSON.stringify(report.jsonInfo, null, 2)}
`
    }, { quoted: msg });

    // enviar json completo si existe
    if (report.detectedType === "was") {

      const jsonFile = fs.readdirSync(extractDir)
        .find(f => f.endsWith(".json"));

      if (jsonFile) {

        await conn.sendMessage(chatId, {
          document: fs.readFileSync(
            path.join(extractDir, jsonFile)
          ),
          fileName: jsonFile,
          mimetype: "application/json"
        }, { quoted: msg });

      }

    }

    await conn.sendMessage(chatId, {
      react: { text: "✅", key: msg.key }
    });

  }
  catch (err) {

    console.error(err);

    await conn.sendMessage(chatId, {
      text: err.message
    }, { quoted: msg });

    await conn.sendMessage(chatId, {
      react: { text: "❌", key: msg.key }
    });

  }
  finally {

    try {

      fs.rmSync(tmpDir, {
        recursive: true,
        force: true
      });

    }
    catch {}

  }

};

handler.command = ["datask"];
handler.help = ["datask"];
handler.tags = ["tools"];
handler.register = true;

module.exports = handler;
