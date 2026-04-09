import { Modulo, ParsedFile, RegistroRow, COLUMN_ALIASES } from '../types';
import { normalize, findColumn, formatDate } from './fileParser';
import { AppError } from '../utils/errors';

export interface ReconciliationResult {
  rows: RegistroRow[];
  columnInfo: {
    gestor: { registro: string | null; fechaVto: string | null };
    tns: { registro: string | null; fechaVto: string | null };
  };
  warnings: string[];
}

interface GestorEntry {
  key: string;
  fechaCance: string;
  fechaVto: string;
  tipo: string;
  valor: string;
  mora: string;
  estadoPago: string;
}

interface TnsEntry {
  key: string;
  fechaCance: string;
  fechaVto: string;
  tipo: string;
  valor: string;
  mora: string;
  estadoPago: string;
}

type ModuleAliases = {
  registro: string[];
  fechaCance: string[];
  fechaVto: string[];
  valor?: string[];
  mora?: string[];
  estadoPago?: string[];
};

// ─── Column detection ────────────────────────────────────────────────────────

function detectSourceColumns(
  file: ParsedFile,
  aliases: ModuleAliases,
  sourceName: string,
  warnings: string[]
): { registroCol: string; fechaCanceCol: string | null; fechaVtoCol: string | null; valorCol: string | null; moraCol: string | null; estadoPagoCol: string | null } {
  const registroCol = findColumn(file.columns, aliases.registro);
  const fechaCanceCol = findColumn(file.columns, aliases.fechaCance);
  const fechaVtoCol = findColumn(file.columns, aliases.fechaVto);
  const valorCol = aliases.valor ? findColumn(file.columns, aliases.valor) : null;
  const moraCol = aliases.mora ? findColumn(file.columns, aliases.mora) : null;
  const estadoPagoCol = aliases.estadoPago ? findColumn(file.columns, aliases.estadoPago) : null;

  if (!registroCol) {
    throw new AppError(
      'ERR_MISSING_COLUMNS',
      `[${sourceName}] No se encontró ninguna columna de alias conocido para el "registro/clave". Columnas presentes: ${file.columns.join(', ')}`
    );
  }

  if (!fechaVtoCol && !fechaCanceCol) {
    warnings.push(`[${sourceName}]: No se encontró columna de fecha. Las fechas quedarán vacías.`);
  }

  return { registroCol, fechaCanceCol, fechaVtoCol, valorCol, moraCol, estadoPagoCol };
}

// ─── TNS row filtering ───────────────────────────────────────────────────────

function filterTnsRows(rows: Record<string, string>[], modulo: Modulo): Record<string, string>[] {
  const rowsToSkip = modulo === 'letras' ? 0 : modulo === 'pagos' ? 3 : 0;
  const sliced = rowsToSkip > 0 ? rows.slice(rowsToSkip) : rows;
  return modulo === 'pagos' ? sliced.filter((_, i) => i % 2 === 0) : sliced;
}

// ─── Entry builders ──────────────────────────────────────────────────────────

/**
 * Builds an array of entries from the GESTOR file.
 * Duplicates (same key) are all preserved — no deduplication, no errors.
 */
function buildGestorEntries(
  parsed: ParsedFile,
  registroCol: string,
  fechaCanceCol: string | null,
  fechaVtoCol: string | null,
  valorCol: string | null,
  moraCol: string | null,
  estadoPagoCol: string | null,
  tipoDefault: string
): GestorEntry[] {
  const entries: GestorEntry[] = [];
  const normalizedColName = normalize(registroCol);

  for (const row of parsed.rows) {
    const reg = normalize(row[registroCol]);
    if (!reg) continue;
    if (reg === normalizedColName) continue;
    if (/^\d{1,4}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(reg)) continue;

    const rawCance = fechaCanceCol ? row[fechaCanceCol] : '';
    const rawVto = fechaVtoCol ? row[fechaVtoCol] : '';

    // Si solo hay una fecha disponible, usarla para ambas
    const finalCance = formatDate(rawCance || rawVto || '');
    const finalVto = formatDate(rawVto || rawCance || '');

    const valor = valorCol ? (row[valorCol] || '') : '';
    const mora = moraCol ? (row[moraCol] || '') : '';
    const estadoPago = estadoPagoCol ? normalize(row[estadoPagoCol] || '') : '';

    entries.push({ key: reg, fechaCance: finalCance, fechaVto: finalVto, tipo: tipoDefault, valor, mora, estadoPago });
  }

  return entries;
}

/**
 * Builds an array of entries from a single TNS file (after row filtering).
 */
function buildTnsEntries(
  rows: Record<string, string>[],
  registroCol: string,
  fechaCanceCol: string | null,
  fechaVtoCol: string | null,
  valorCol: string | null,
  moraCol: string | null,
  estadoPagoCol: string | null,
  tipoDefault: string
): TnsEntry[] {
  const entries: TnsEntry[] = [];
  const normalizedColName = normalize(registroCol);

  for (const row of rows) {
    const reg = normalize(row[registroCol]);
    if (!reg) continue;
    if (reg === normalizedColName) continue;
    if (/^\d{1,4}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(reg)) continue;

    const rawCance = fechaCanceCol ? row[fechaCanceCol] : '';
    const rawVto = fechaVtoCol ? row[fechaVtoCol] : '';

    const finalCance = formatDate(rawCance || rawVto || '');
    const finalVto = formatDate(rawVto || rawCance || '');

    const valor = valorCol ? (row[valorCol] || '') : '';
    const mora = moraCol ? (row[moraCol] || '') : '';
    const estadoPago = estadoPagoCol ? normalize(row[estadoPagoCol] || '') : '';

    entries.push({ key: reg, fechaCance: finalCance, fechaVto: finalVto, tipo: tipoDefault, valor, mora, estadoPago });
  }

  return entries;
}

// ─── Matching ────────────────────────────────────────────────────────────────

/**
 * Matches gestor entries to TNS entries via substring containment.
 * Duplicates in GESTOR (same key) are all shown — each gets its own result row.
 * If one TNS entry matches N gestor duplicates, it produces N rows all marked "Ambos".
 */
function buildMatchedRows(
  gestorEntries: GestorEntry[],
  tnsEntries: TnsEntry[],
  modulo: Modulo
): RegistroRow[] {
  const rows: RegistroRow[] = [];
  // Track matched gestor by index so duplicates each get evaluated independently
  const matchedGestorIndices = new Set<number>();

  // 1. TNS entries first (preserves TNS file order)
  for (const tnsEntry of tnsEntries) {
    let matchedGestorIdx = -1;
    for (let i = 0; i < gestorEntries.length; i++) {
      if (!matchedGestorIndices.has(i) && tnsEntry.key.includes(gestorEntries[i].key)) {
        matchedGestorIdx = i;
        break; // Match 1-to-1
      }
    }

    if (matchedGestorIdx !== -1) {
      matchedGestorIndices.add(matchedGestorIdx);
      const ge = gestorEntries[matchedGestorIdx];
      const estadoPago = ge.estadoPago || tnsEntry.estadoPago;
      rows.push({
        registro: tnsEntry.key,
        tipo: ge.tipo,
        fechaCance: ge.fechaCance || tnsEntry.fechaCance || '',
        fechaVto: ge.fechaVto || tnsEntry.fechaVto || '',
        gestor: true,
        tns: true,
        estadoConciliacion: 'Ambos',
        modulo,
        valor: ge.valor || undefined,
        mora: ge.mora || undefined,
        estadoPago: estadoPago || undefined,
      });
    } else {
      rows.push({
        registro: tnsEntry.key,
        tipo: tnsEntry.tipo,
        fechaCance: tnsEntry.fechaCance || '',
        fechaVto: tnsEntry.fechaVto,
        gestor: false,
        tns: true,
        estadoConciliacion: 'Solo TNS',
        modulo,
        valor: tnsEntry.valor || undefined,
        mora: tnsEntry.mora || undefined,
        estadoPago: tnsEntry.estadoPago || undefined,
      });
    }
  }

  // 2. Unmatched gestor entries (Solo Gestor) — includes unmatched duplicates
  for (let i = 0; i < gestorEntries.length; i++) {
    if (!matchedGestorIndices.has(i)) {
      const ge = gestorEntries[i];
      rows.push({
        registro: ge.key,
        tipo: ge.tipo,
        fechaCance: ge.fechaCance || '',
        fechaVto: ge.fechaVto,
        gestor: true,
        tns: false,
        estadoConciliacion: 'Solo Gestor',
        modulo,
        valor: ge.valor || undefined,
        mora: ge.mora || undefined,
        estadoPago: ge.estadoPago || undefined,
      });
    }
  }

  return rows;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function reconcile(
  modulo: Modulo,
  gestorFile: ParsedFile | null,
  tnsFiles: ParsedFile[]   // ahora acepta múltiples archivos TNS
): ReconciliationResult {
  const warnings: string[] = [];
  const aliases = COLUMN_ALIASES[modulo] as ModuleAliases;
  const tipoDefault = modulo === 'pagos' ? 'RECIBO' : 'LETRA';

  // ---- GESTOR ----
  let gestorRegistroCol: string | null = null;
  let gestorFechaVtoCol: string | null = null;
  let gestorEntries: GestorEntry[] = [];

  if (gestorFile) {
    const d = detectSourceColumns(gestorFile, aliases, 'GESTOR', warnings);
    gestorRegistroCol = d.registroCol;
    gestorFechaVtoCol = d.fechaVtoCol;
    gestorEntries = buildGestorEntries(
      gestorFile,
      d.registroCol,
      d.fechaCanceCol,
      d.fechaVtoCol,
      d.valorCol,
      d.moraCol,
      d.estadoPagoCol,
      tipoDefault
    );
  }

  // ---- TNS (merge de todos los archivos) ----
  let tnsRegistroCol: string | null = null;
  let tnsFechaVtoCol: string | null = null;
  let tnsEntries: TnsEntry[] = [];

  for (const tnsFile of tnsFiles) {
    const d = detectSourceColumns(tnsFile, aliases, 'TNS', warnings);
    if (!tnsRegistroCol) tnsRegistroCol = d.registroCol;
    if (!tnsFechaVtoCol) tnsFechaVtoCol = d.fechaVtoCol;

    const filteredRows = filterTnsRows(tnsFile.rows, modulo);
    const fileEntries = buildTnsEntries(
      filteredRows,
      d.registroCol,
      d.fechaCanceCol,
      d.fechaVtoCol,
      d.valorCol,
      d.moraCol,
      d.estadoPagoCol,
      tipoDefault
    );
    tnsEntries = tnsEntries.concat(fileEntries);
  }

  const rows = buildMatchedRows(gestorEntries, tnsEntries, modulo);

  return {
    rows,
    columnInfo: {
      gestor: { registro: gestorRegistroCol, fechaVto: gestorFechaVtoCol },
      tns: { registro: tnsRegistroCol, fechaVto: tnsFechaVtoCol },
    },
    warnings,
  };
}