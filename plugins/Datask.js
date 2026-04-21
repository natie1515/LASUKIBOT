// plugins/datask.js

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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

  if (wa?.downloadContentFromMessage)
    return wa;

  if (conn?.wa?.downloadContentFromMessage)
    return conn.wa;

  if (global.wa?.downloadContentFromMessage)
    return global.wa;

  return null;

}

const handler = async (msg, { conn, wa }) => {

  const chatId = msg.key.remoteJid;

  const quotedRaw =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  if (!quotedRaw) {

    return conn.sendMessage(chatId, {

      text: "Responde al sticker animado"

    }, { quoted: msg });

  }

  const q = unwrapMessage(quotedRaw);

  console.log("LOG estructura mensaje:");
  console.log(JSON.stringify(q, null, 2));

  await conn.sendMessage(chatId, {
    text:
"📊 LOG detectado:\n\n" +
JSON.stringify(q, null, 2).slice(0, 3500)
  }, { quoted: msg });

  const stickerMsg = q?.stickerMessage;
  const docMsg = q?.documentMessage;
  const imageMsg = q?.imageMessage;

  let node = null;
  let dlType = "document";

  if (stickerMsg) {

    node = stickerMsg;
    dlType = "sticker";

  }
  else if (docMsg) {

    node = docMsg;
    dlType = "document";

  }
  else if (imageMsg) {

    node = imageMsg;
    dlType = "image";

  }
  else {

    return conn.sendMessage(chatId, {

      text:
"No detecto stickerMessage ni documentMessage\n" +
"revisa el LOG enviado arriba"

    }, { quoted: msg });

  }

  await conn.sendMessage(chatId, {
    react: { text: "🔍", key: msg.key }
  }).catch(()=>{});

  const tmpDir =
    path.join(__dirname, "../tmp");

  if (!fs.existsSync(tmpDir))
    fs.mkdirSync(tmpDir, { recursive: true });

  const base = Date.now();

  const inputFile =
    path.join(tmpDir, base + ".bin");

  const extractDir =
    path.join(tmpDir, base + "_extract");

  try {

    const WA =
      ensureWA(wa, conn);

    const stream =
      await WA.downloadContentFromMessage(
        node,
        dlType
      );

    let buffer =
      Buffer.alloc(0);

    for await (const chunk of stream)
      buffer = Buffer.concat([
        buffer,
        chunk
      ]);

    fs.writeFileSync(
      inputFile,
      buffer
    );

    let type = "unknown";

    if (
      buffer.slice(0, 4)
      .toString()
      === "PK\u0003\u0004"
    ) type = "ZIP / WAS";

    if (
      buffer.slice(8, 12)
      .toString()
      === "WEBP"
    ) type = "WEBP";

    let info =
`RESULTADO

tipo detectado:
${type}

peso:
${buffer.length}

mime:
${node.mimetype || "unknown"}
`;

    await conn.sendMessage(
      chatId,
      { text: info },
      { quoted: msg }
    );

    if (type.includes("ZIP")) {

      fs.mkdirSync(
        extractDir,
        { recursive: true }
      );

      execSync(
`unzip "${inputFile}" -d "${extractDir}"`
      );

      const files =
        fs.readdirSync(
          extractDir,
          { recursive: true }
        );

      await conn.sendMessage(
        chatId,
        {

          text:
"archivos internos:\n\n" +
files.join("\n")

        },
        { quoted: msg }
      );

      for (const f of files) {

        if (!f.endsWith(".json"))
          continue;

        const full =
          path.join(
            extractDir,
            f
          );

        const json =
          fs.readFileSync(
            full,
            "utf8"
          );

        await conn.sendMessage(
          chatId,
          {

            document:
              Buffer.from(json),

            fileName: f,

            mimetype:
              "application/json"

          },
          { quoted: msg }
        );

      }

    }

    await conn.sendMessage(
      chatId,
      {
        react:
        { text: "✅", key: msg.key }
      }
    );

  }
  catch (e) {

    console.log(e);

    await conn.sendMessage(
      chatId,
      {

        text:
"error:\n" +
e.message

      },
      { quoted: msg }
    );

    await conn.sendMessage(
      chatId,
      {
        react:
        { text: "❌", key: msg.key }
      }
    );

  }

};

handler.command = ["datask"];
handler.help = ["datask"];
handler.tags = ["tools"];
handler.register = true;

module.exports = handler;
