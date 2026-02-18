import ExcelJS from 'exceljs';
import { RegistroRow, Modulo } from '../types';

export async function generateExcel(rows: RegistroRow[], modulo: Modulo): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Conciliación App';
  wb.created = new Date();

  const ws = wb.addWorksheet(`Cruce ${modulo.charAt(0).toUpperCase() + modulo.slice(1)}`);

  // ---- Define columns ----
  ws.columns = [
    { header: 'Registro', key: 'registro', width: 28 },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Fecha Vto', key: 'fechaVto', width: 16 },
    { header: 'Gestor', key: 'gestor', width: 10 },
    { header: 'TNS', key: 'tns', width: 10 },
    { header: 'Estado Conciliación', key: 'estadoConciliacion', width: 22 },
  ];

  // ---- Header styling ----
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      left: { style: 'thin', color: { argb: 'FFAAAAAA' } },
      right: { style: 'thin', color: { argb: 'FFAAAAAA' } },
    };
  });
  headerRow.height = 22;

  // ---- Color scheme per estado ----
  const estadoColors: Record<string, string> = {
    Ambos: 'FFD9EAD3',         // light green
    'Solo Gestor': 'FFFFF2CC', // light yellow
    'Solo TNS': 'FFFCE4D6',    // light orange
  };

  // ---- Data rows ----
  rows.forEach((r, i) => {
    const row = ws.addRow({
      registro: r.registro,
      tipo: r.tipo,
      fechaVto: r.fechaVto,
      gestor: r.gestor ? 'X' : '',
      tns: r.tns ? 'X' : '',
      estadoConciliacion: r.estadoConciliacion,
    });

    const bgColor = estadoColors[r.estadoConciliacion] ?? 'FFFFFFFF';
    const isEven = i % 2 === 0;
    const rowBg = isEven ? bgColor : blendColor(bgColor);

    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.border = {
        top: { style: 'hair', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'hair', color: { argb: 'FFCCCCCC' } },
        left: { style: 'hair', color: { argb: 'FFCCCCCC' } },
        right: { style: 'hair', color: { argb: 'FFCCCCCC' } },
      };
    });

    // Center X columns
    ['gestor', 'tns'].forEach((k) => {
      const cell = row.getCell(k);
      cell.alignment = { horizontal: 'center' };
      if (cell.value === 'X') {
        cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FF1F4E79' } };
      }
    });

    row.getCell('fechaVto').alignment = { horizontal: 'center' };
    row.getCell('tipo').alignment = { horizontal: 'center' };
    row.height = 18;
  });

  // ---- Summary rows ----
  ws.addRow([]);
  const total = rows.length;
  const ambos = rows.filter((r) => r.estadoConciliacion === 'Ambos').length;
  const soloG = rows.filter((r) => r.estadoConciliacion === 'Solo Gestor').length;
  const soloT = rows.filter((r) => r.estadoConciliacion === 'Solo TNS').length;

  const summaryData = [
    ['Total registros', total],
    ['Ambos (conciliados)', ambos],
    ['Solo Gestor', soloG],
    ['Solo TNS', soloT],
  ];

  summaryData.forEach(([label, value]) => {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true, name: 'Arial', size: 10 };
    row.getCell(2).font = { name: 'Arial', size: 10 };
  });

  // ---- Freeze header ----
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // ---- Auto filter ----
  ws.autoFilter = { from: 'A1', to: 'F1' };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Slightly darken a hex ARGB color for alternating rows */
function blendColor(argb: string): string {
  if (argb === 'FFFFFFFF') return 'FFF5F5F5';
  // Darken by reducing each channel by ~10
  const r = Math.max(0, parseInt(argb.slice(2, 4), 16) - 12).toString(16).padStart(2, '0');
  const g = Math.max(0, parseInt(argb.slice(4, 6), 16) - 12).toString(16).padStart(2, '0');
  const b = Math.max(0, parseInt(argb.slice(6, 8), 16) - 12).toString(16).padStart(2, '0');
  return `FF${r}${g}${b}`;
}
