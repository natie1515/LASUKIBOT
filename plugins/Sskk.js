const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

function unwrapMessage(m){

let node = m;

while(

node?.viewOnceMessage?.message ||
node?.viewOnceMessageV2?.message ||
node?.viewOnceMessageV2Extension?.message ||
node?.ephemeralMessage?.message

){

node =
node.viewOnceMessage?.message ||
node.viewOnceMessageV2?.message ||
node.viewOnceMessageV2Extension?.message ||
node.ephemeralMessage?.message;

}

return node;

}

function ensureWA(wa,conn){

if(wa?.downloadContentFromMessage)
return wa;

if(conn?.wa?.downloadContentFromMessage)
return conn.wa;

if(global.wa?.downloadContentFromMessage)
return global.wa;

return null;

}

function createLottie(base64,w,h){

return {

v:"5.9.0",
fr:60,
ip:0,
op:180,
w,
h,
nm:"sskk",
ddd:0,
assets:[
{

id:"image_0",
w,
h,
u:"",
p:`data:image/png;base64,${base64}`,
e:1

}
],

layers:[
{

ddd:0,
ind:1,
ty:2,
nm:"image",
cl:"png",
refId:"image_0",
sr:1,
ks:{
o:{a:0,k:100},
r:{a:0,k:0},
p:{a:0,k:[w/2,h/2,0]},
a:{a:0,k:[w/2,h/2,0]},
s:{a:0,k:[100,100,100]}
},
ao:0,
ip:0,
op:180,
st:0,
bm:0

}
]

};

}

function hashFile(content){

return crypto
.createHash("sha256")
.update(content)
.digest("hex");

}

const handler = async (msg,{conn,wa})=>{

const chatId =
msg.key.remoteJid;

const quotedRaw =
msg.message?.extendedTextMessage
?.contextInfo?.quotedMessage;

if(!quotedRaw){

return conn.sendMessage(chatId,{

text:
"responde a una imagen"

},{quoted:msg});

}

const q =
unwrapMessage(quotedRaw);

const imageMsg =
q?.imageMessage;

if(!imageMsg){

return conn.sendMessage(chatId,{

text:
"eso no es imagen"

},{quoted:msg});

}

await conn.sendMessage(chatId,{
react:{text:"⚙️",key:msg.key}
}).catch(()=>{});

try{

const WA =
ensureWA(wa,conn);

const stream =
await WA.downloadContentFromMessage(
imageMsg,
"image"
);

let buffer =
Buffer.alloc(0);

for await(const chunk of stream)
buffer = Buffer.concat([buffer,chunk]);

const base64 =
buffer.toString("base64");

const tmpDir =
path.join(
__dirname,
"../tmp_"+Date.now()
);

fs.mkdirSync(tmpDir);

const animDir =
path.join(tmpDir,"animation");

fs.mkdirSync(animDir);

const lottie512 =
createLottie(base64,512,512);

const lottie2048 =
createLottie(base64,2048,2048);

const jsonMain =
JSON.stringify(lottie512);

const jsonSecondary =
JSON.stringify(lottie2048);

fs.writeFileSync(
path.join(animDir,"animation.json"),
jsonMain
);

fs.writeFileSync(
path.join(animDir,"animation_secondary.json"),
jsonSecondary
);

fs.writeFileSync(

path.join(animDir,"animation.json.trust_token"),

hashFile(jsonMain)

);

fs.writeFileSync(

path.join(animDir,"animation_secondary.json.trust_token"),

hashFile(jsonSecondary)

);

fs.writeFileSync(

path.join(animDir,"animation.json.overridden_metadata"),

JSON.stringify({

loop:true,
autoplay:true

})

);

const wasPath =
path.join(tmpDir,"sticker.was");

execSync(
`cd "${tmpDir}" && zip -r sticker.was animation`
);

await conn.sendMessage(chatId,{

sticker:
fs.readFileSync(wasPath),

mimetype:
"application/was"

},{quoted:msg});

await conn.sendMessage(chatId,{
react:{text:"✅",key:msg.key}
});

}
catch(e){

console.log(e);

await conn.sendMessage(chatId,{

text:
"error\n"+e.message

},{quoted:msg});

await conn.sendMessage(chatId,{
react:{text:"❌",key:msg.key}
});

}

};

handler.command =
["sskk"];

handler.help =
["sskk"];

handler.tags =
["tools"];

handler.register =
true;

module.exports =
handler;
