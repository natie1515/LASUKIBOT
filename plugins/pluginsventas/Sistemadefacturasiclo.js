// plugins/factura_watcher.js
// Revisa facturas cada 15s, marca vencidas como "no pagado" y
// envía una factura-recordatorio (mismo diseño que addfactura)
// al CLIENTE y al VENDEDOR. Evita bucles con `recordatorioEnviado`.

import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

const CHECK_INTERVAL_MS = 15 * 1000;

function limpiarNumero(n) {
  return String(n || "").replace(/\D/g, "");
}

function formatFecha(ts) {
  const d = new Date(ts);
  try {
    return d.toLocaleString("es-ES", {
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: true
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

/**
 * MISMO estilo que addfactura, pero en ROJO:
 * - Banda superior oscura
 * - Logo redondo
 * - Título "FACTURA • NO PAGADA" en rojo
 * - Sello diagonal "NO PAGADO" en rojo
 * - Pie en verde: "Aceptamos EXTRA si quieres apoyar el servicio"
 */
async function generarFacturaNoPagadaPNG(f) {
  const W = 1100, H = 650;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Fondo
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Banda superior
  ctx.fillStyle = "#111827"; // gris oscuro
  ctx.fillRect(0, 0, W, 120);

  // Logo redondo
  try {
    const logoUrl = f.logoUrl || "https://cdn.russellxz.click/35741757.jpg";
    const logo = await loadImage(logoUrl);
    const size = 90, x = 30, y = 15;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(logo, x, y, size, size);
    ctx.restore();
  } catch {}

  // Títulos
  ctx.fillStyle = "#ef4444"; // rojo
  ctx.font = "bold 34px Sans-Serif";
  ctx.fillText("FACTURA • NO PAGADA", 140, 55);

  ctx.fillStyle = "#ffffff";
  ctx.font = "16px Sans-Serif";
  ctx.fillText(`Generada: ${formatFecha(f.fechaCreacion)}`, 140, 85);

  // Caja de datos
  const boxX = 40, boxY = 150, boxW = W - 80, boxH = 360;
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle = "#111827";
  ctx.font = "bold 24px Sans-Serif";
  ctx.fillText("Detalle de la Factura", boxX + 20, boxY + 40);

  ctx.font = "18px Sans-Serif";
  const L = 30;
  let yy = boxY + 80;

  ctx.fillText(`Servicio: ${f.servicio || "-"}`, boxX + 20, yy); yy += L;
  ctx.fillText(`Precio: ${f.precio != null ? f.precio : "-"}`, boxX + 20, yy); yy += L;
  ctx.fillText(`Ciclo: ${f.ciclo?.texto || "-"}`, boxX + 20, yy); yy += L;
  ctx.fillText(`Próximo pago (vencido): ${formatFecha(f.fechaProximoPago)}`, boxX + 20, yy); yy += L;

  yy += 20;
  ctx.font = "bold 20px Sans-Serif";
  ctx.fillText("Cliente", boxX + 20, yy);
  ctx.fillText("Vendedor", boxX + boxW / 2 + 10, yy);
  yy += 30;

  ctx.font = "18px Sans-Serif";
  ctx.fillText(`Nombre: ${f.cliente?.nombre || "-"}`, boxX + 20, yy);
  ctx.fillText(`Nombre: ${f.vendedor?.nombre || "-"}`, boxX + boxW / 2 + 10, yy);
  yy += L;
  ctx.fillText(`Número: ${f.cliente?.numero || "-"}`, boxX + 20, yy);
  ctx.fillText(`Número: ${f.vendedor?.numero || "-"}`, boxX + boxW / 2 + 10, yy);

  // Sello "NO PAGADO"
  ctx.save();
  ctx.translate(W - 260, boxY + 120);
  ctx.rotate(-Math.PI / 12);
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 6;
  ctx.strokeRect(-10, -40, 240, 80);
  ctx.fillStyle = "#ef4444";
  ctx.font = "bold 28px Sans-Serif";
  ctx.fillText("NO PAGADO", 18, 10);
  ctx.restore();

  // Pie en verde (solo texto pedido)
  ctx.fillStyle = "#10b981";
  ctx.font = "bold 18px Sans-Serif";
  ctx.fillText("Aceptamos EXTRA si quieres apoyar el servicio", 40, H - 30);

  return canvas.toBuffer("image/png");
}

function construirCaptionDetallado(f) {
  // exactamente como lo pediste, con fechas formateadas
  return (
`🧾 *FACTURA NO PAGADA*
🆔 ID: ${f.id || "-"}
💼 Servicio: ${f.servicio || "-"}
💰 Precio: ${f.precio != null ? f.precio : "-"}
🔄 Ciclo: ${f.ciclo?.texto || "-" }
📅 Creada: ${formatFecha(f.fechaCreacion)}
📅 Vencida: ${formatFecha(f.fechaProximoPago)}

👤 Cliente: ${f.cliente?.nombre || "-"} (${f.cliente?.numero || "-"})
🛒 Vendedor: ${f.vendedor?.nombre || "-"} (${f.vendedor?.numero || "-"})

💡 Aceptamos *extra/propina* si deseas apoyar el servicio.`
  );
}

const handler = async (conn) => {
  setInterval(async () => {
    try {
      const filePath = path.join(process.cwd(), "facturas.json");
      if (!fs.existsSync(filePath)) return;

      let db;
      try {
        db = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (e) {
        console.error("[factura_watcher] Error leyendo facturas.json:", e);
        return;
      }
      db.facturas = Array.isArray(db.facturas) ? db.facturas : [];
      if (db.facturas.length === 0) return;

      const ahora = Date.now();
      let huboCambios = false;

      for (const f of db.facturas) {
        const proximo = Number(f.fechaProximoPago || 0);
        const vencida = proximo > 0 && ahora >= proximo;
        const yaEnviada = Boolean(f.recordatorioEnviado);

        if (vencida && !yaEnviada) {
          try {
            // Marcar y registrar
            f.estado = "no pagado";
            f.recordatorioEnviado = true;
            f.fechaRecordatorio = ahora;
            f.historial = Array.isArray(f.historial) ? f.historial : [];
            f.historial.push({
              fecha: ahora,
              evento: "recordatorio_no_pagado",
              detalle: "Se envió recordatorio de factura NO PAGADA al cliente y al vendedor"
            });
            huboCambios = true;

            // Generar imagen y caption detallado
            const buffer = await generarFacturaNoPagadaPNG(f);
            const caption = construirCaptionDetallado(f);

            const clienteJid = limpiarNumero(f.cliente?.numero) + "@s.whatsapp.net";
            const vendedorJid = limpiarNumero(f.vendedor?.numero) + "@s.whatsapp.net";

            // Enviar a ambos
            try { if (clienteJid.length > 15) await conn.sendMessage(clienteJid, { image: buffer, caption }); } catch (e) { console.error("[factura_watcher] Envío cliente:", e); }
            try { if (vendedorJid.length > 15) await conn.sendMessage(vendedorJid, { image: buffer, caption }); } catch (e) { console.error("[factura_watcher] Envío vendedor:", e); }

          } catch (eItem) {
            console.error("[factura_watcher] Error generando/enviando recordatorio:", eItem);
          }
        }
      }

      if (huboCambios) {
        try {
          fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
        } catch (e) {
          console.error("[factura_watcher] Error guardando facturas.json:", e);
        }
      }
    } catch (err) {
      console.error("[factura_watcher] Error del watcher:", err);
    }
  }, CHECK_INTERVAL_MS);

  console.log("[factura_watcher] Iniciado (revisa facturas cada 15s).");
};

// Para que tu loader lo ejecute como otros sistemas
handler.run = handler;
export default handler;
