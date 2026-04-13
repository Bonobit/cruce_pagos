import { PDFParse } from 'pdf-parse';
import { ParsedFile } from '../types';
import { AppError } from '../utils/errors';
import { normalize } from './fileParser';
import { logger } from '../utils/logger';
import path from 'path';
import fs from 'fs';
import { TEMP_DIR } from '../utils/assets';

// Robust detection of SEA or Pkg environment
const isPkg = typeof (process as any).pkg !== 'undefined';
const isSea = !isPkg && typeof process.execPath === 'string' && 
  (process.execPath.toLowerCase().endsWith('cruce_pagos.exe') || 
   process.execPath.toLowerCase().endsWith('reconciliation-app.exe') ||
   process.execPath.toLowerCase().endsWith('node.exe') === false);

if (isPkg || isSea) {
  const workerPath = path.join(TEMP_DIR, 'pdf.worker.mjs');
  
  if (fs.existsSync(workerPath)) {
    const workerUrl = `file://${workerPath.replace(/\\/g, '/')}`;
    logger.info({ workerUrl }, 'Configurando worker de PDFJS extraído en temporal');
    // @ts-ignore
    PDFParse.setWorker(workerUrl);
  } else {
    logger.warn({ workerPath }, 'No se encontró el worker de PDFJS en la carpeta temporal.');
  }
}

const MONEY_RE = /^\$?[\d.,]+$/;

function cleanMoney(val: string): string {
  return val.trim().replace(/\./g, '').replace(/,/g, '.');
}

function cleanMoneyTns(val: string): string {
  // TNS format is 1,000.00
  return val.trim().replace(/,/g, '');
}

function cleanDate(val: string): string {
  return val.trim();
}

// ─── Parser: TNS Libro Auxiliar ──────────────────────────────────────────────
// Columnas: FECHA | COMPROBANTE/TIPO DCTO | TERCERO/DETALLE | DEBE | HABER
function parsePdfLibroAuxiliar(lines: string[]): ParsedFile {
  const columns = ['FECHA', 'COMPROBANTE/TIPO DCTO', 'TERCERO/DETALLE', 'DEBE', 'HABER'];
  const rows: Record<string, string>[] = [];
  
  const DATE_RE = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const tokens = line.split(/\s+/).map(t => t.trim()).filter(Boolean);
    
    if (tokens.length >= 4 && DATE_RE.test(tokens[0])) {
      const fecha = tokens[0];
      const comprobante = tokens[1];
      
      // Filtrar basura: Si el comprobante es solo números con puntos/comas (ej: 0.00) no es un ID válido para cruce
      if (/^[\d,.]+$/.test(comprobante) && comprobante.length < 8) continue;

      const haber = tokens[tokens.length - 1]; // HABER es el último bloque
      const debe = tokens[tokens.length - 2];  // DEBE es el penúltimo
      
      rows.push({
        'FECHA': cleanDate(fecha),
        'COMPROBANTE/TIPO DCTO': comprobante,
        'TERCERO/DETALLE': tokens.slice(2, tokens.length - 2).join(' '),
        'DEBE': cleanMoneyTns(debe),
        'HABER': cleanMoneyTns(haber),
      });
    }
  }
  
  return { rows, columns, isPdf: true };
}

// ─── Parser: TNS Cartera por Cuotas ──────────────────────────────────────────
// Columnas: DOCUMENTO | DETALLE | CONCEPTO | FECHA EMISION | FECHA VCTO | VALOR | SALDO | MORA | TOTAL
function parsePdfTns(lines: string[]): ParsedFile {
  const columns = ['DOCUMENTO', 'DETALLE', 'CONCEPTO', 'FECHA EMISION', 'FECHA VENCIMIENTO', 'DIAS VCTO', 'VALOR', 'SALDO', 'MORA', 'TOTAL'];
  const rows: Record<string, string>[] = [];
  
  const DATE_RE = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g;
  const MONEY_RE = /[\d\.,]+/g;
  
  let currentDoc = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detectar línea de datos: Tiene al menos 2 fechas y varios números
    const dates = line.match(DATE_RE);
    if (dates && dates.length >= 2) {
      // Es una línea de valores (ej: "ETAPA 01/01/2025 30/12/2025 95 100,000.00 ...")
      // Buscamos hacia atrás para obtener el documento y detalle si no están en esta línea
      
      const doc = lines[i - 3]?.trim() || currentDoc;
      const detalle = lines[i - 2]?.trim() || '';
      const conceptoPrefix = lines[i - 1]?.trim() || '';
      
      const lineWithoutDates = line.replace(DATE_RE, '');
      const diasMatch = lineWithoutDates.match(/-?\d+/);
      const diasVcto = diasMatch ? diasMatch[0] : '';
      const monetarios = lineWithoutDates.match(/[\d]{1,3}(?:,[\d]{3})*(?:\.[\d]{2})/g) || [];
      
      if (monetarios.length >= 4) {
        const [valor, saldo, mora, total] = monetarios.slice(-4);
        
        rows.push({
          'DOCUMENTO': doc,
          'NUMERO': doc, // Alias para compatibilidad con letras
          'DETALLE': detalle,
          'CONCEPTO': `${conceptoPrefix} ${line.split(dates[0])[0].trim()}`.trim(),
          'FECHA EMISION': dates[0],
          'FECHA VENCIMIENTO': dates[1],
          'DIAS VCTO': diasVcto,
          'VALOR': cleanMoneyTns(valor),
          'SALDO': cleanMoneyTns(saldo),
          'MORA': cleanMoneyTns(mora),
          'TOTAL': cleanMoneyTns(total),
        });
        
        if (doc) currentDoc = doc;
      }
    }
  }
  
  return { rows, columns, isPdf: true };
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
  return { rows, columns, isPdf: true };
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
  return { rows, columns, isPdf: true };
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
  const hasTns = normText.includes('CARTERA POR CUOTAS');
  const hasLibro = normText.includes('LIBRO AUXILIAR');

  if (!hasHistorico && !hasPendientes && !hasTns && !hasLibro) {
    throw new AppError(
      'ERR_FILE_CORRUPT',
      `El PDF "${filename}" no contiene tablas reconocidas del Gestor o TNS. ` +
      `Se esperaba "Histórico de Pagos", "Pagos Pendientes", "Cartera por Cuotas" o "Libro Auxiliar".`
    );
  }

  if (hasLibro) return parsePdfLibroAuxiliar(lines);
  if (hasTns) return parsePdfTns(lines);

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
  } catch (rawErr: any) {
    logger.error({ filename, err: rawErr, stack: rawErr?.stack }, 'Error interno parseando PDF');
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