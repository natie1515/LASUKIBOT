// plugins/facturapaga.js
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const limpiarNumero = n => String(n || "").replace(/\D/g, "");
function formatFecha(ts) {
  const d = new Date(ts);
  return d.toLocaleString("es-ES", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}

async function generarFacturaPagaPNG({ logoUrl, datos }) {
  const W = 1100, H = 650;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, W, 120);
  try {
    const logo = await loadImage(logoUrl);
    const size = 90, x = 30, y = 15;
    ctx.save(); ctx.beginPath(); ctx.arc(x+size/2, y+size/2, size/2, 0, Math.PI*2); ctx.closePath(); ctx.clip();
    ctx.drawImage(logo, x, y, size, size); ctx.restore();
  } catch {}
  ctx.fillStyle = "#ffffff"; ctx.font = "bold 34px Sans-Serif";
  ctx.fillText("FACTURA • PAGO EXITOSO", 140, 55);
  ctx.font = "16px Sans-Serif";
  ctx.fillText(`Generada: ${formatFecha(datos.fechaCreacion)}`, 140, 85);
  const boxX = 40, boxY = 150, boxW = W - 80, boxH = 360;
  ctx.fillStyle = "#f3f4f6"; ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.fillStyle = "#111827"; ctx.font = "bold 24px Sans-Serif";
  ctx.fillText("Detalle de la Factura", boxX + 20, boxY + 40);
  ctx.font = "18px Sans-Serif"; const L = 30; let yy = boxY + 80;
  ctx.fillText(`Servicio: ${datos.servicio}`, boxX + 20, yy); yy += L;
  ctx.fillText(`Precio: $ ${Number(datos.precio).toFixed(2)}`, boxX + 20, yy); yy += L;
  ctx.fillText(`Ciclo: cada ${datos.ciclo.texto}`, boxX + 20, yy); yy += L;
  ctx.fillText(`Próximo pago: ${formatFecha(datos.fechaProximoPago)}`, boxX + 20, yy); yy += L;
  yy += 20; ctx.font = "bold 20px Sans-Serif";
  ctx.fillText("Cliente", boxX + 20, yy);
  ctx.fillText("Vendedor", boxX + boxW / 2 + 10, yy); yy += 30;
  ctx.font = "18px Sans-Serif";
  ctx.fillText(`Nombre: ${datos.cliente.nombre}`, boxX + 20, yy);
  ctx.fillText(`Nombre: ${datos.vendedor.nombre}`, boxX + boxW / 2 + 10, yy); yy += L;
  ctx.fillText(`Número: ${datos.cliente.numero}`, boxX + 20, yy);
  ctx.fillText(`Número: ${datos.vendedor.numero}`, boxX + boxW / 2 + 10, yy);
  ctx.save(); ctx.translate(W - 260, boxY + 120); ctx.rotate(-Math.PI/12);
  ctx.strokeStyle = "#10b981"; ctx.lineWidth = 6; ctx.strokeRect(-10, -40, 240, 80);
  ctx.fillStyle = "#10b981"; ctx.font = "bold 28px Sans-Serif"; ctx.fillText("PAGO EXITOSO", 8, 10);
  ctx.restore();
  ctx.fillStyle = "#6b7280"; ctx.font = "14px Sans-Serif";
  ctx.fillText("Gracias por su pago. Esta es la confirmación de su ciclo actual.", 40, H - 30);
  return canvas.toBuffer("image/png");
}

const handler = async (msg, { conn, args, command }) => {
  const chatId = msg.key.remoteJid;
  await conn.sendMessage(chatId, { react: { text: "💳", key: msg.key } });

  const sender = msg.key.participant || msg.key.remoteJid;
  const numero = limpiarNumero(sender);
  const fromMe = msg.key.fromMe;
  const botID = limpiarNumero(conn.user?.id || "");
  if (!global.isOwner(numero) && !fromMe && numero !== botID) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: "🚫 Solo los owners o el mismo bot pueden usar este comando." }, { quoted: msg });
  }

  if (args.length < 2) {
    return conn.sendMessage(chatId, { text:
`✳️ *Uso correcto:*
.${command} <numeroCliente> <servicio>

📌 Ejemplo:
.${command} 52163xxxxxxxx netflix` }, { quoted: msg });
  }

  const numeroCliente = limpiarNumero(args[0]);
  const servicio = String(args.slice(1).join(" ")).toLowerCase().trim();
  if (!numeroCliente || !servicio) {
    return conn.sendMessage(chatId, { text: "❌ Parámetros inválidos.", quoted: msg });
  }

  const filePath = path.join(process.cwd(), "facturas.json");
  if (!fs.existsSync(filePath)) {
    return conn.sendMessage(chatId, { text: "📂 Aún no existe *facturas.json*.", quoted: msg });
  }

  let db;
  try { db = JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return conn.sendMessage(chatId, { text: "❌ Error leyendo *facturas.json*.", quoted: msg }); }
  db.facturas = Array.isArray(db.facturas) ? db.facturas : [];

  // Buscar la más reciente de ese cliente/servicio
  const idxs = db.facturas
    .map((f, i) => ({ f, i }))
    .filter(({ f }) =>
      limpiarNumero(f?.cliente?.numero) === numeroCliente &&
      String(f?.servicio || "").toLowerCase().trim() === servicio
    );

  if (idxs.length === 0) {
    return conn.sendMessage(chatId, {
      text: `🔎 No hay facturas para:\n• Cliente: *${numeroCliente}*\n• Servicio: *${servicio}*`,
      quoted: msg
    });
  }

  const { f: base, i: baseIdx } = idxs.sort((a, b) => Number(b.f.fechaCreacion||0) - Number(a.f.fechaCreacion||0))[0];

  // ✅ RENOVAR EN EL MISMO REGISTRO (NO crear otro)
  const ahora = Date.now();
  const ciclo = base?.ciclo || { valor:1, unidad:"d", ms: 24*60*60*1000, texto:"1d" };

  base.fechaCreacion = ahora;
  base.fechaProximoPago = ahora + Number(ciclo.ms || 0);
  base.estado = "pagado";
  base.recordatorioEnviado = false;        // para que el watcher vuelva a notificar cuando toque
  base.fechaRecordatorio = null;
  base.historial = Array.isArray(base.historial) ? base.historial : [];
  base.historial.push({ fecha: ahora, evento: "pago", detalle: "Pago registrado (PAGO EXITOSO - renovación)" });

  // Mantener logo / nombres / numeros / ciclo tal cual
  db.facturas[baseIdx] = base;

  // Guardar
  try { fs.writeFileSync(filePath, JSON.stringify(db, null, 2)); }
  catch { return conn.sendMessage(chatId, { text: "❌ Error guardando *facturas.json*.", quoted: msg }); }

  // Generar imagen con los datos renovados
  let buffer;
  try {
    buffer = await generarFacturaPagaPNG({
      logoUrl: base.logoUrl,
      datos: {
        servicio: base.servicio,
        precio: base.precio,
        ciclo: base.ciclo,
        fechaCreacion: base.fechaCreacion,
        fechaProximoPago: base.fechaProximoPago,
        cliente: base.cliente,
        vendedor: base.vendedor
      }
    });
  } catch (e) {
    await conn.sendMessage(chatId, { react: { text: "❌", key: msg.key } });
    return conn.sendMessage(chatId, { text: `❌ Error al generar la factura: ${e.message}` }, { quoted: msg });
  }

  const caption =
`🧾 *Factura generada (PAGO EXITOSO)*
📄 ID: ${base.id}
🛠 Servicio: ${base.servicio}
💵 Precio: $ ${Number(base.precio).toFixed(2)}
🔁 Ciclo: cada ${base.ciclo.texto}
🗓 Creada: ${formatFecha(base.fechaCreacion)}
⏭ Próximo pago: ${formatFecha(base.fechaProximoPago)}

👤 Cliente: ${base.cliente.nombre} (+${base.cliente.numero})
🏪 Vendedor: ${base.vendedor.nombre} (+${base.vendedor.numero})`;

  // DEDUP de envíos
  const enviados = new Set();
  const safeSend = async (jid) => {
    if (!jid || enviados.has(jid)) return;
    enviados.add(jid);
    try { await conn.sendMessage(jid, { image: buffer, caption }); } catch {}
  };

  await safeSend(chatId);
  const cliJid = `${base.cliente.numero}@s.whatsapp.net`;
  const venJid = `${base.vendedor.numero}@s.whatsapp.net`;
  if (cliJid !== chatId) await safeSend(cliJid);
  if (venJid !== chatId) await safeSend(venJid);

  await conn.sendMessage(chatId, { react: { text: "✅", key: msg.key } });
};

handler.command = ["facturapaga", "facpaga"];
export default handler;
