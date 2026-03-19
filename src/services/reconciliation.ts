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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detects registro and fechaVto columns for a given source file.
 * Throws if no alias matches for the registro (crucial code).
 */
function detectSourceColumns(
  file: ParsedFile,
  aliases: { registro: string[]; fechaVto: string[] },
  sourceName: string,
  warnings: string[]
): { registroCol: string; fechaCol: string | null } {
  const registroCol = findColumn(file.columns, aliases.registro);
  const fechaCol = findColumn(file.columns, aliases.fechaVto);

  if (!registroCol) {
    throw new AppError(
      'ERR_MISSING_COLUMNS',
      `[${sourceName}] No se encontró ninguna columna de alias conocido para el "registro/clave". Columnas presentes: ${file.columns.join(', ')}`
    );
  }
  
  if (!fechaCol) {
    warnings.push(`[${sourceName}]: No se encontró columna de fecha. La fecha de vencimiento quedará vacía en caso de no cruzar.`);
  }

  return { registroCol, fechaCol };
}

/**
 * Applies TNS-specific row filtering depending on the module.
 * Letras: skip first metadata row.
 * Pagos: skip first 3 metadata rows, then keep every other row.
 */
function filterTnsRows(
  rows: Record<string, string>[],
  modulo: Modulo
): Record<string, string>[] {
  const rowsToSkip = modulo === 'letras' ? 1 : modulo === 'pagos' ? 3 : 0;
  const sliced = rowsToSkip > 0 ? rows.slice(rowsToSkip) : rows;
  return modulo === 'pagos' ? sliced.filter((_, i) => i % 2 === 0) : sliced;
}

/**
 * Extracts a map of registro -> {fechaVto, tipo} from parsed rows.
 * Throws ERR_DUPLICATES_GESTOR if isGestor is true and there are duplicates with different dates.
 */
export function buildMap(
  parsed: ParsedFile,
  registroCol: string,
  fechaVtoCol: string | null,
  tipoDefault: string,
  isGestor: boolean
): Map<string, { fechaVto: string; tipo: string }> {
  const map = new Map<string, { fechaVto: string; tipo: string }>();
  const normalizedColName = normalize(registroCol);

  for (const row of parsed.rows) {
    const reg = normalize(row[registroCol]);
    if (!reg) continue;
    // Skip the row if the registro value IS the column header itself (header parsed as data row)
    if (reg === normalizedColName) continue;
    // Skip values that look like dates (M/DD/YY, MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, etc.)
    if (/^\d{1,4}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(reg)) continue;

    const fechaRaw = fechaVtoCol ? row[fechaVtoCol] : '';
    const fecha = formatDate(fechaRaw || '');

    if (!map.has(reg)) {
      map.set(reg, { fechaVto: fecha, tipo: tipoDefault });
    } else {
      const existing = map.get(reg)!;
      
      // Valida regla estricta sobre duplicados en GESTOR
      if (isGestor && fecha && existing.fechaVto && fecha !== existing.fechaVto) {
         throw new AppError(
           'ERR_DUPLICATES_GESTOR', 
           `Se encontró un registro duplicado en archivo GESTOR con el identificador "${reg}" y distintas fechas de vencimiento (${existing.fechaVto} vs ${fecha}).`
         );
      }

      // Keep earliest date (most proxima) among duplicates logically for non-erroring duplicates or TNS
      if (fecha && existing.fechaVto) {
        const d1 = new Date(fechaRaw || '');
        const d2 = new Date(existing.fechaVto);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d1 < d2) {
          map.set(reg, { fechaVto: fecha, tipo: tipoDefault });
        }
      } else if (fecha && !existing.fechaVto) {
        map.set(reg, { fechaVto: fecha, tipo: tipoDefault });
      }
    }
  }

  return map;
}

/**
 * Builds the reconciliation row list using substring matching:
 * gestorKey must be contained within tnsKey.
 * Iterates TNS first (preserving file order), then appends GESTOR-only rows.
 */
export function buildMatchedRows(
  gestorMap: Map<string, { fechaVto: string; tipo: string }>,
  tnsMap: Map<string, { fechaVto: string; tipo: string }>,
  modulo: Modulo
): RegistroRow[] {
  const rows: RegistroRow[] = [];
  const matchedGestorKeys = new Set<string>();

  // 1. Iterate TNS keys first (preserves TNS file order)
  for (const tnsKey of tnsMap.keys()) {
    const tnsData = tnsMap.get(tnsKey)!;

    // Find a GESTOR key that is contained within this TNS key
    let matchedGestorKey: string | undefined;
    for (const gestorKey of gestorMap.keys()) {
      if (tnsKey.includes(gestorKey)) {
        matchedGestorKey = gestorKey;
        break;
      }
    }

    const inGestor = !!matchedGestorKey;
    if (inGestor) matchedGestorKeys.add(matchedGestorKey!);

    const gestorData = matchedGestorKey ? gestorMap.get(matchedGestorKey) : undefined;
    const tipo = gestorData?.tipo ?? tnsData.tipo;
    const fechaVto = gestorData?.fechaVto || tnsData.fechaVto || '';
    const estado: RegistroRow['estadoConciliacion'] = inGestor ? 'Ambos' : 'Solo TNS';

    rows.push({ registro: tnsKey, tipo, fechaVto, gestor: inGestor, tns: true, estadoConciliacion: estado, modulo });
  }

  // 2. GESTOR-only rows (those not matched to any TNS)
  for (const [gestorKey, gestorData] of gestorMap.entries()) {
    if (!matchedGestorKeys.has(gestorKey)) {
      rows.push({ registro: gestorKey, tipo: gestorData.tipo, fechaVto: gestorData.fechaVto, gestor: true, tns: false, estadoConciliacion: 'Solo Gestor', modulo });
    }
  }

  return rows;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function reconcile(
  modulo: Modulo,
  gestorFile: ParsedFile | null,
  tnsFile: ParsedFile | null
): ReconciliationResult {
  const warnings: string[] = [];
  const aliases = COLUMN_ALIASES[modulo];
  const tipoDefault = modulo === 'pagos' ? 'RECIBO' : 'LETRA';

  // ---- Detect columns and build GESTOR map ----
  let gestorRegistroCol: string | null = null;
  let gestorFechaCol: string | null = null;
  let gestorMap = new Map<string, { fechaVto: string; tipo: string }>();

  if (gestorFile) {
    ({ registroCol: gestorRegistroCol, fechaCol: gestorFechaCol } = detectSourceColumns(
      gestorFile, aliases, 'GESTOR', warnings
    ));
    if (gestorRegistroCol) {
      // isGestor = true -> lanzará error si hay duplicados con distintas fechas
      gestorMap = buildMap(gestorFile, gestorRegistroCol, gestorFechaCol, tipoDefault, true);
    }
  }

  // ---- Detect columns and build TNS map ----
  let tnsRegistroCol: string | null = null;
  let tnsFechaCol: string | null = null;
  let tnsMap = new Map<string, { fechaVto: string; tipo: string }>();

  if (tnsFile) {
    ({ registroCol: tnsRegistroCol, fechaCol: tnsFechaCol } = detectSourceColumns(
      tnsFile, aliases, 'TNS', warnings
    ));
    if (tnsRegistroCol) {
      const filteredRows = filterTnsRows(tnsFile.rows, modulo);
      const tnsParsed = { ...tnsFile, rows: filteredRows };
      // isGestor = false
      tnsMap = buildMap(tnsParsed, tnsRegistroCol, tnsFechaCol, tipoDefault, false);
    }
  }

  // ---- Build result rows (no sorting — preserves source file order) ----
  const rows = buildMatchedRows(gestorMap, tnsMap, modulo);

  return {
    rows,
    columnInfo: {
      gestor: { registro: gestorRegistroCol, fechaVto: gestorFechaCol },
      tns: { registro: tnsRegistroCol, fechaVto: tnsFechaCol },
    },
    warnings,
  };
}
