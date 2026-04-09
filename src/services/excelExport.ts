import ExcelJS from 'exceljs';
import { RegistroRow } from '../types';

// ─── Color helpers ────────────────────────────────────────────────────────────

const estadoConciliacionColors: Record<string, string> = {
  Ambos: 'FFD9EAD3',
  'Solo Gestor': 'FFFFF2CC',
  'Solo TNS': 'FFFCE4D6',
};

const estadoPagoColors: Record<string, string> = {
  PAGADO: 'FFD9EAD3',
  PAGADA: 'FFD9EAD3',
  PENDIENTE: 'FFFFF2CC',
  'EN ESPERA': 'FFFFF2CC',
  'EN ESPERA DE PAGO': 'FFFFF2CC',
};

function blendColor(argb: string): string {
  if (argb === 'FFFFFFFF') return 'FFF5F5F5';
  const r = Math.max(0, parseInt(argb.slice(2, 4), 16) - 12).toString(16).padStart(2, '0');
  const g = Math.max(0, parseInt(argb.slice(4, 6), 16) - 12).toString(16).padStart(2, '0');
  const b = Math.max(0, parseInt(argb.slice(6, 8), 16) - 12).toString(16).padStart(2, '0');
  return `FF${r}${g}${b}`;
}

function normalizeEstadoPago(raw: string | undefined): string {
  if (!raw) return '';
  const upper = raw.toUpperCase().trim();
  if (upper === 'PAGADO' || upper === 'PAGADA') return 'Pagado';
  if (upper === 'PENDIENTE' || upper === 'EN ESPERA' || upper === 'EN ESPERA DE PAGO') return 'En espera de pago';
  // Devolver con primera letra mayúscula si no reconocemos el valor
  return upper.charAt(0) + upper.slice(1).toLowerCase();
}

function styleHeader(row: ExcelJS.Row, bgArgb = 'FF1F4E79') {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      left: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      right: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    };
  });
  row.height = 22;
}

function styleDataCell(cell: ExcelJS.Cell, bgArgb: string) {
  cell.font = { name: 'Arial', size: 10 };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
  cell.border = {
    top: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    left: { style: 'hair', color: { argb: 'FFCCCCCC' } },
    right: { style: 'hair', color: { argb: 'FFCCCCCC' } },
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateExcel(rows: RegistroRow[], type: 'cruce' | 'pagos' = 'cruce'): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Conciliación App';
  wb.created = new Date();

  if (type === 'cruce') {
    // ══════════════════════════════════════════════════════════════════════
    // HOJA 1: Cruce Completo
    // ══════════════════════════════════════════════════════════════════════
    const ws = wb.addWorksheet('Cruce Completo');

    const hasEstadoPago = rows.some((r) => r.estadoPago && r.estadoPago.trim() !== '');

    const columns: Partial<ExcelJS.Column>[] = [
      { header: 'Módulo', key: 'modulo', width: 10 },
      { header: 'Registro', key: 'registro', width: 28 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Fecha Cancelación', key: 'fechaCance', width: 16 },
      { header: 'Fecha Vto', key: 'fechaVto', width: 16 },
      { header: 'Valor', key: 'valor', width: 18 },
      { header: 'Gestor', key: 'gestor', width: 10 },
      { header: 'TNS', key: 'tns', width: 10 },
      { header: 'Mora', key: 'mora', width: 12 },
      { header: 'Estado Conciliación', key: 'estadoConciliacion', width: 22 },
    ];

    if (hasEstadoPago) {
      columns.push({ header: 'Pago', key: 'estadoPago', width: 20 });
    }

    ws.columns = columns;

    styleHeader(ws.getRow(1));

    rows.forEach((r, i) => {
      const valorNum = r.valor ? parseFloat(r.valor.replace(/[^0-9.-]/g, '')) : NaN;
      const row = ws.addRow({
        modulo: r.modulo,
        registro: r.registro,
        tipo: r.tipo,
        fechaCance: r.fechaCance,
        fechaVto: r.fechaVto,
        valor: !isNaN(valorNum) ? valorNum : (r.valor || ''),
        gestor: r.gestor ? 'X' : '',
        tns: r.tns ? 'X' : '',
        mora: r.mora || '',
        estadoConciliacion: r.estadoConciliacion,
        estadoPago: normalizeEstadoPago(r.estadoPago),
      });

      const bgBase = estadoConciliacionColors[r.estadoConciliacion] ?? 'FFFFFFFF';
      const bgArgb = i % 2 === 0 ? bgBase : blendColor(bgBase);

      row.eachCell((cell) => styleDataCell(cell, bgArgb));

      // Centro en columnas de marca y tipo
      ['gestor', 'tns', 'tipo', 'fechaVto'].forEach((k) => {
        row.getCell(k).alignment = { horizontal: 'center' };
      });

      // Negrita para X
      ['gestor', 'tns'].forEach((k) => {
        const cell = row.getCell(k);
        if (cell.value === 'X') {
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1F4E79' } };
        }
      });

      // Formato de número para Valor
      const valCell = row.getCell('valor');
      if (!isNaN(valorNum)) {
        valCell.numFmt = '#,##0';
        valCell.alignment = { horizontal: 'right' };
      }

      row.height = 18;
    });

    // Fila de resumen al final
    ws.addRow([]);
    const total = rows.length;
    const ambos = rows.filter((r) => r.estadoConciliacion === 'Ambos').length;
    const soloG = rows.filter((r) => r.estadoConciliacion === 'Solo Gestor').length;
    const soloT = rows.filter((r) => r.estadoConciliacion === 'Solo TNS').length;

    [
      ['Total registros', total],
      ['Ambos (conciliados)', ambos],
      ['Solo Gestor', soloG],
      ['Solo TNS', soloT],
    ].forEach(([label, value]) => {
      const row = ws.addRow([label, value]);
      row.getCell(1).font = { bold: true, name: 'Arial', size: 10 };
      row.getCell(2).font = { name: 'Arial', size: 10 };
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: hasEstadoPago ? 'I1' : 'H1' };
  }

  if (type === 'pagos') {
    // ══════════════════════════════════════════════════════════════════════
    // HOJA 2: Estado de Pago (tabla independiente)
    // ══════════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet('Estado de Pago');

    ws2.columns = [
      { header: 'Módulo', key: 'modulo', width: 10 },
      { header: 'Registro', key: 'registro', width: 28 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Fecha Cancelación', key: 'fechaCance', width: 16 },
      { header: 'Fecha Vto', key: 'fechaVto', width: 16 },
      { header: 'Valor', key: 'valor', width: 18 },
      { header: 'Mora', key: 'mora', width: 12 },
      { header: 'Estado de Pago', key: 'estadoPago', width: 24 },
      { header: 'Estado Conciliación', key: 'estadoConciliacion', width: 22 },
    ];

    styleHeader(ws2.getRow(1), 'FF375623'); // verde oscuro para diferenciar la hoja

    // Incluir todos los registros — estadoPago puede ser vacío (mostrar "Sin información")
    rows.forEach((r, i) => {
      const estadoPagoNorm = normalizeEstadoPago(r.estadoPago);
      const valorNum = r.valor ? parseFloat(r.valor.replace(/[^0-9.-]/g, '')) : NaN;

      const row = ws2.addRow({
        modulo: r.modulo,
        registro: r.registro,
        tipo: r.tipo,
        fechaCance: r.fechaCance,
        fechaVto: r.fechaVto,
        valor: !isNaN(valorNum) ? valorNum : (r.valor || ''),
        mora: r.mora || '',
        estadoPago: estadoPagoNorm || 'Sin información',
        estadoConciliacion: r.estadoConciliacion,
      });

      // Color basado en el estado de pago normalizado
      const upperNorm = estadoPagoNorm.toUpperCase();
      const bgBase = estadoPagoColors[upperNorm] ?? 'FFFFFFFF';
      const bgArgb = i % 2 === 0 ? bgBase : blendColor(bgBase);

      row.eachCell((cell) => styleDataCell(cell, bgArgb));

      ['tipo', 'fechaVto', 'estadoPago'].forEach((k) => {
        row.getCell(k).alignment = { horizontal: 'center' };
      });

      // Negrita y color para el estado de pago
      const estadoCell = row.getCell('estadoPago');
      const ep = estadoPagoNorm.toUpperCase();
      if (ep === 'PAGADO' || ep === 'PAGADA') {
        estadoCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF375623' } };
      } else if (ep.startsWith('EN ESPERA') || ep === 'PENDIENTE') {
        estadoCell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF7D6008' } };
      } else {
        estadoCell.font = { name: 'Arial', size: 10, color: { argb: 'FF666666' } };
      }

      // Formato numérico para Valor
      const valCell = row.getCell('valor');
      if (!isNaN(valorNum)) {
        valCell.numFmt = '#,##0';
        valCell.alignment = { horizontal: 'right' };
      }

      row.height = 18;
    });

    // Resumen por estado de pago
    ws2.addRow([]);
    ws2.addRow([]);

    const resumenRow = ws2.addRow(['Resumen Estado de Pago']);
    resumenRow.getCell(1).font = { bold: true, name: 'Arial', size: 12, color: { argb: 'FF1F4E79' } };

    ws2.addRow([]);

    // Agrupar por estadoPago normalizado
    const groupMap = new Map<string, number>();
    for (const r of rows) {
      const key = normalizeEstadoPago(r.estadoPago) || 'Sin información';
      groupMap.set(key, (groupMap.get(key) ?? 0) + 1);
    }

    const summaryHeaderRow = ws2.addRow(['Estado', 'Cantidad']);
    summaryHeaderRow.eachCell((cell) => {
      cell.font = { bold: true, name: 'Arial', size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF375623' } };
      cell.alignment = { horizontal: 'center' };
    });
    summaryHeaderRow.height = 18;

    for (const [estado, count] of groupMap.entries()) {
      const sumRow = ws2.addRow([estado, count]);
      sumRow.getCell(1).font = { name: 'Arial', size: 10 };
      sumRow.getCell(2).font = { bold: true, name: 'Arial', size: 10 };
      sumRow.getCell(2).alignment = { horizontal: 'center' };
    }

    ws2.views = [{ state: 'frozen', ySplit: 1 }];
    ws2.autoFilter = { from: 'A1', to: 'G1' };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}