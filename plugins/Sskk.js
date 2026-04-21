const fs = require("fs");
const path = require("path");

const { buildLottieSticker } =
require("../Lottie-Whatsapp/src");

const DB = "./ssy_db.json";

function unwrapMessage(m){

let n=m;

while(

n?.viewOnceMessage?.message ||
n?.viewOnceMessageV2?.message ||
n?.ephemeralMessage?.message

){

n=
n.viewOnceMessage?.message ||
n.viewOnceMessageV2?.message ||
n.ephemeralMessage?.message;

}

return n;

}

function ensureWA(wa,conn){

if(wa?.downloadContentFromMessage)
return wa;

if(conn?.wa?.downloadContentFromMessage)
return conn.wa;

return null;

}

const handler = async (msg,{conn,wa,args})=>{

const chatId =
msg.key.remoteJid;

const key =
(args||[]).join(" ")
.toLowerCase()
.trim();

if(!key){

return conn.sendMessage(chatId,{
text:
"usa:\n.sskk nombre"
},{quoted:msg});

}

const db=
JSON.parse(
fs.readFileSync(DB)
);

if(!db[key]){

return conn.sendMessage(chatId,{
text:
"no existe imagen"
},{quoted:msg});

}

const quoted =
msg.message?.extendedTextMessage
?.contextInfo?.quotedMessage;

const q=
unwrapMessage(quoted);

const stickerNode=

q?.stickerMessage ||
q?.lottieStickerMessage
?.message?.stickerMessage;

if(!stickerNode){

return conn.sendMessage(chatId,{
text:
"responde a sticker animado"
},{quoted:msg});

}

try{

const WA=
ensureWA(wa,conn);

const stream=
await WA.downloadContentFromMessage(
stickerNode,
"sticker"
);

let wasBuffer=
Buffer.alloc(0);

for await(const chunk of stream)
wasBuffer=
Buffer.concat([wasBuffer,chunk]);

const tmpDir=
"./tmp_"+Date.now();

fs.mkdirSync(tmpDir);

const wasPath=
path.join(tmpDir,"base.was");

fs.writeFileSync(
wasPath,
wasBuffer
);

// extraer base
require("child_process")
.execSync(
`unzip ${wasPath} -d ${tmpDir}`
);

// crear nuevo
const output=
await buildLottieSticker({

baseFolder:
tmpDir,

imagePath:
db[key],

output:
path.join(tmpDir,"new.was")

});

// enviar sticker
await conn.sendMessage(
chatId,
{
sticker:
fs.readFileSync(output)
},
{quoted:msg}
);

}
catch(e){

conn.sendMessage(chatId,{
text:
e.message
},{quoted:msg});

}

};

handler.command=["sskk"];

module.exports=handler;
