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
  displayKey: string;
  fechaCance: string;
  fechaVto: string;
  tipo: string;
  valor: string;
  mora: string;
  estadoPago: string;
}

interface TnsEntry {
  key: string;
  displayKey: string;
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

// ─── Key Normalization ───────────────────────────────────────────────────────

/**
 * Normaliza una clave de registro para que el cruce sea robusto ante errores de OCR
 * y diferencias de formato (prefijos/sufijos).
 */
function normalizeKey(key: string): string {
  if (!key) return '';
  return key.trim().toUpperCase();
}

/**
 * Normalización agresiva solo para fallback ante errores de lectura.
 */
function robustNormalize(val: string): string {
  if (!val) return '';
  return val
    .toUpperCase()
    .replace(/L/g, 'I')
    .replace(/O/g, '0')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Normaliza el estado de pago. Si no es 'En espera', se asume 'Pagado'.
 */
function normalizeEstadoPago(val: string): string {
  const n = normalize(val);
  if (n.includes('ESPERA')) return 'En espera de pago';
  return 'Pagado';
}

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
    const rawValue = row[registroCol]?.toString() || '';
    if (!rawValue) continue;
    if (normalize(rawValue) === normalizedColName) continue;
    
    const key = normalizeKey(rawValue);
    if (!key) continue;

    const rawCance = fechaCanceCol ? row[fechaCanceCol] : '';
    const rawVto = fechaVtoCol ? row[fechaVtoCol] : '';

    const finalCance = formatDate(rawCance || rawVto || '');
    const finalVto = formatDate(rawVto || rawCance || '');

    const valor = valorCol ? (row[valorCol] || '') : '';
    const mora = moraCol ? (row[moraCol] || '') : '';
    const estadoPago = estadoPagoCol ? normalizeEstadoPago(row[estadoPagoCol] || '') : 'Pagado';

    entries.push({ 
      key, 
      displayKey: rawValue, 
      fechaCance: finalCance, 
      fechaVto: finalVto, 
      tipo: tipoDefault, 
      valor, 
      mora, 
      estadoPago 
    });
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
    const rawValue = row[registroCol]?.toString() || '';
    if (!rawValue) continue;
    if (normalize(rawValue) === normalizedColName) continue;
    
    const key = normalizeKey(rawValue);
    if (!key) continue;

    const rawCance = fechaCanceCol ? row[fechaCanceCol] : '';
    const rawVto = fechaVtoCol ? row[fechaVtoCol] : '';

    const finalCance = formatDate(rawCance || rawVto || '');
    const finalVto = formatDate(rawVto || rawCance || '');

    const valor = valorCol ? (row[valorCol] || '') : '';
    const mora = moraCol ? (row[moraCol] || '') : '';
    const estadoPago = estadoPagoCol ? normalizeEstadoPago(row[estadoPagoCol] || '') : 'Pagado';

    entries.push({ 
      key, 
      displayKey: rawValue, 
      fechaCance: finalCance, 
      fechaVto: finalVto, 
      tipo: tipoDefault, 
      valor, 
      mora, 
      estadoPago 
    });
  }

  return entries;
}

// ─── Value comparison ────────────────────────────────────────────────────────

/**
 * Normaliza un valor monetario a número para comparación.
 * Soporta formatos: "1.234,56", "1,234.56", "1234.56", "1234,56"
 */
function normalizeValor(val: string): number | null {
  if (!val || !val.trim()) return null;
  // Eliminar símbolos de moneda, espacios y asteriscos
  let s = val.replace(/[$ \t*]/g, '');
  if (!s) return null;

  // Detectar si usa punto como separador de miles y coma como decimal, o viceversa
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Formato: "1.234,56" → eliminar punto, cambiar coma a punto
    if (s.indexOf('.') < s.indexOf(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato: "1,234.56" → eliminar coma
      s = s.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // "1234,56" → decimal con coma
    s = s.replace(',', '.');
  }
  // Si solo tiene punto, ya está en formato correcto

  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Compara dos valores monetarios. Retorna true si son iguales (±0.01 de tolerancia).
 * Si alguno de los valores está vacío, no se puede comparar → retorna null.
 */
function valoresIguales(v1: string, v2: string): boolean | null {
  const n1 = normalizeValor(v1);
  const n2 = normalizeValor(v2);
  if (n1 === null || n2 === null) return null; // no se puede comparar
  return Math.abs(n1 - n2) <= 0.01;
}

// ─── Matching ────────────────────────────────────────────────────────────────

/**
 * Matches gestor entries to TNS entries via substring containment.
 * Duplicates in GESTOR (same key) are all shown — each gets its own result row.
 * If one TNS entry matches N gestor duplicates, it produces N rows all marked "Ambos".
 * Cuando ambas entradas tienen valor, se valida que sean iguales para confirmar el match.
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
      if (matchedGestorIndices.has(i)) continue;
      
      const gKey = gestorEntries[i].key;
      const tKey = tnsEntry.key;

      // 1. Coincidencia directa o contención (normalizada simple)
      let isMatch = tKey.includes(gKey) || gKey.includes(tKey);

      // 2. Fallback: Normalización robusta (OCR fallback)
      if (!isMatch) {
        const tRobust = robustNormalize(tnsEntry.displayKey);
        const gRobust = robustNormalize(gestorEntries[i].displayKey);
        isMatch = tRobust.includes(gRobust) || gRobust.includes(tRobust);
      }

      // 3. Fallback adicional para letras: intentar ignorar sufijos numéricos del Gestor
      if (!isMatch && modulo === 'letras') {
        const gestorBase = gKey.replace(/\d+$/, '');
        if (gestorBase.length >= 4) {
          isMatch = tKey.includes(gestorBase) || gestorBase.includes(tKey);
        }
      }

      // 4. Si la clave coincide, validar que el valor sea igual (cuando ambos tienen valor)
      if (isMatch) {
        const valorCheck = valoresIguales(gestorEntries[i].valor, tnsEntry.valor);
        if (valorCheck === false) {
          // Claves iguales pero valores distintos → no es match
          isMatch = false;
        }
        // Si valorCheck === null (alguno no tiene valor), se acepta el match por clave
      }

      if (isMatch) {
        matchedGestorIdx = i;
        break;
      }
    }

    if (matchedGestorIdx !== -1) {
      matchedGestorIndices.add(matchedGestorIdx);
      const ge = gestorEntries[matchedGestorIdx];
      const estadoPago = ge.estadoPago || tnsEntry.estadoPago;
      rows.push({
        registro: ge.displayKey, // Usar la clave original del GESTOR
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
        registro: tnsEntry.displayKey,
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
        registro: ge.displayKey,
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

    const filteredRows = tnsFile.isPdf ? tnsFile.rows : filterTnsRows(tnsFile.rows, modulo);
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