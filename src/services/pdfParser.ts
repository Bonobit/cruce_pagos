import { PDFParse } from 'pdf-parse';
import { ParsedFile } from '../types';
import { AppError } from '../utils/errors';
import { normalize } from './fileParser';

const MONEY_RE = /^\$?[\d.,]+$/;

function cleanMoney(val: string): string {
  return val.trim().replace(/\./g, '').replace(/,/g, '.');
}

function cleanDate(val: string): string {
  return val.trim();
}

// ─── Parser: Histórico de Pagos ───────────────────────────────────────────────
// Columnas: FECHA | FECHA DE PAGO | RECIBO | VALOR
function parseHistoricoPagos(lines: string[]): ParsedFile {
  const columns = ['FECHA', 'FECHA DE PAGO', 'RECIBO', 'VALOR'];
  const rows: Record<string, string>[] = [];
  let inTable = false;
  const DATE_RE = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
  const NUM_RE = /^\d+$/;

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    const normLine = normalize(raw);
    if (!inTable) {
      if (normLine.includes('FECHA') && (normLine.includes('RECIBO') || normLine.includes('VALOR'))) {
        inTable = true;
      }
      continue;
    }
    if (normLine.startsWith('TOTAL') || normLine.startsWith('TENGA EN CUENTA')) break;

    // Split por 2+ espacios o tabs (como el PDF extrae la tabla)
    const tokens = raw.split(/\s{2,}|\t/).map(t => t.trim()).filter(Boolean);
    if (tokens.length >= 4) {
      const [fecha, fechaPago, recibo, valor] = tokens;
      if (DATE_RE.test(fecha) || /^\d{4}[\/\-]/.test(fecha)) {
        rows.push({
          'FECHA': cleanDate(fecha),
          'FECHA DE PAGO': cleanDate(fechaPago),
          'RECIBO': recibo.trim(),
          'VALOR': cleanMoney(valor),
        });
        continue;
      }
    }

    // Fallback: dividir por espacio simple, buscar número de recibo + valor
    const parts = raw.trim().split(/\s+/);
    if (parts.length >= 4 && DATE_RE.test(parts[0])) {
      for (let i = 1; i < parts.length - 1; i++) {
        if (NUM_RE.test(parts[i]) && MONEY_RE.test(parts[i + 1])) {
          rows.push({
            'FECHA': cleanDate(parts[0]),
            'FECHA DE PAGO': cleanDate(parts.slice(1, i).join(' ')),
            'RECIBO': parts[i],
            'VALOR': cleanMoney(parts[i + 1]),
          });
          break;
        }
      }
    }
  }
  return { rows, columns };
}

// ─── Parser: Pagos Pendientes ─────────────────────────────────────────────────
// Columnas: Fecha Vencimiento | Saldo | Número | Mora | Estado
function parsePagosPendientes(lines: string[]): ParsedFile {
  const columns = ['FECHA VENCIMIENTO', 'SALDO', 'NUMERO', 'MORA', 'ESTADO'];
  const rows: Record<string, string>[] = [];
  let inTable = false;
  const DATE_RE = /^\d{4}[\/\-]\d{2}[\/\-]\d{2}$|^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;

  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    const normLine = normalize(raw);
    if (!inTable) {
      if (
        (normLine.includes('FECHA') && normLine.includes('SALDO')) ||
        (normLine.includes('NUMERO') && normLine.includes('ESTADO'))
      ) {
        inTable = true;
      }
      continue;
    }
    if (normLine.startsWith('TENGA EN CUENTA') || normLine.startsWith('EN ESPERA')) break;

    const tokens = raw.split(/\s{2,}|\t/).map(t => t.trim()).filter(Boolean);
    if (tokens.length >= 4) {
      const [fechaCance, fechaVto, saldo, numero, mora, ...rest] = tokens;
      if (DATE_RE.test(fechaVto)) {
        const estado = rest.length > 0 ? rest[rest.length - 1] : (mora && !MONEY_RE.test(mora) ? mora : '');
        const moraVal = mora && MONEY_RE.test(mora) ? cleanMoney(mora) : '$0';
        rows.push({
          'FECHA CANCELACION': cleanDate(fechaCance),
          'FECHA VENCIMIENTO': cleanDate(fechaVto),
          'SALDO': cleanMoney(saldo),
          'NUMERO': numero.trim(),
          'MORA': moraVal,
          'ESTADO': estado.trim(),
        });
        continue;
      }
    }

    // Fallback
    const parts = raw.trim().split(/\s+/);
    if (parts.length >= 4 && DATE_RE.test(parts[0])) {
      const numIdx = parts.findIndex(p => /^[A-Z]{2,}/i.test(p) && p.length >= 3);
      if (numIdx > 0) {
        rows.push({
          'FECHA CANCELACION': cleanDate(parts[0]),
          'FECHA VENCIMIENTO': cleanDate(parts[0]),
          'SALDO': cleanMoney(parts.slice(1, numIdx).join('')),
          'NUMERO': parts[numIdx],
          'MORA': parts[numIdx + 1] ? cleanMoney(parts[numIdx + 1]) : '$0',
          'ESTADO': parts.slice(numIdx + 2).join(' ').trim(),
        });
      }
    }
  }
  return { rows, columns };
}

// ─── parsePdfText: función pura exportada (testeable sin mocks) ───────────────
/**
 * Procesa texto extraído de un PDF del Gestor.
 * Exportada para unit tests directos sin necesidad de mockear pdf-parse.
 */
export function parsePdfText(text: string, filename: string): ParsedFile {
  if (!text.trim()) {
    throw new AppError(
      'ERR_FILE_CORRUPT',
      `El PDF "${filename}" no contiene texto extraíble (puede ser una imagen escaneada).`
    );
  }
  const normText = normalize(text);
  const lines = text.split(/\r?\n/);
  const hasHistorico = normText.includes('HISTORICO DE PAGOS') || normText.includes('HISTORICO PAGOS');
  const hasPendientes = normText.includes('PAGOS PENDIENTES');

  if (!hasHistorico && !hasPendientes) {
    throw new AppError(
      'ERR_FILE_CORRUPT',
      `El PDF "${filename}" no contiene tablas reconocidas del Gestor. ` +
      `Se esperaba "Histórico de Pagos" o "Pagos Pendientes".`
    );
  }

  if (hasHistorico && hasPendientes) {
    const historico = parseHistoricoPagos(lines);
    const pendientes = parsePagosPendientes(lines);
    return historico.rows.length >= pendientes.rows.length ? historico : pendientes;
  }

  if (hasHistorico) return parseHistoricoPagos(lines);
  return parsePagosPendientes(lines);
}

// ─── parsePdfGestor: función pública con I/O del PDF ─────────────────────────
/**
 * Extrae tabla(s) de un PDF del Gestor (Celeus / similar).
 * Auto-detecta formato: "Histórico de Pagos" o "Pagos Pendientes".
 */
export async function parsePdfGestor(buffer: Buffer, filename: string): Promise<ParsedFile> {
  let parser: PDFParse | undefined;
  let text = '';
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = result.text;
    require('fs').writeFileSync('debug_pdf.txt', text);
  } catch (rawErr) {
    console.error('Error interno parseando PDF:', rawErr);
    throw new AppError(
      'ERR_FILE_CORRUPT',
      `No se pudo leer el PDF "${filename}". Asegúrate de que no está protegido con contraseña.`
    );
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
  return parsePdfText(text || '', filename);
}
