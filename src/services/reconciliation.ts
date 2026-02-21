import { Modulo, ParsedFile, RegistroRow, COLUMN_ALIASES } from '../types';
import { normalize, findColumn, formatDate } from './fileParser';

export interface ReconciliationResult {
  rows: RegistroRow[];
  columnInfo: {
    gestor: { registro: string | null; fechaVto: string | null };
    tns: { registro: string | null; fechaVto: string | null };
  };
  warnings: string[];
}

/**
 * Extracts a map of registro -> {fechaVto, tipo} from parsed rows.
 * Duplicate registros: keeps the one with the earliest fechaVto (most proxima).
 */
function buildMap(
  parsed: ParsedFile,
  registroCol: string,
  fechaVtoCol: string | null,
  tipoDefault: string
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
      // Keep earliest date (most proxima) among duplicates
      const existing = map.get(reg)!;
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

export function reconcile(
  modulo: Modulo,
  gestorFile: ParsedFile | null,
  tnsFile: ParsedFile | null
): ReconciliationResult {
  const warnings: string[] = [];
  const aliases = COLUMN_ALIASES[modulo];
  const tipoDefault = modulo === 'pagos' ? 'RECIBO' : 'LETRA';

  // ---- Detect columns for GESTOR ----
  let gestorRegistroCol: string | null = null;
  let gestorFechaCol: string | null = null;
  let gestorMap = new Map<string, { fechaVto: string; tipo: string }>();

  if (gestorFile) {
    gestorRegistroCol = findColumn(gestorFile.columns, aliases.registro);
    gestorFechaCol = findColumn(gestorFile.columns, aliases.fechaVto);

    if (!gestorRegistroCol) {
      gestorRegistroCol = gestorFile.columns[0] || null;
      warnings.push(
        `GESTOR: No se encontró columna de registro conocida. Se usó "${gestorRegistroCol}" como clave.`
      );
    }
    if (!gestorFechaCol) {
      warnings.push('GESTOR: No se encontró columna de fecha. La fecha vto quedará vacía.');
    }

    if (gestorRegistroCol) {
      gestorMap = buildMap(gestorFile, gestorRegistroCol, gestorFechaCol, tipoDefault);
    }
  }

  // ---- Detect columns for TNS ----
  let tnsRegistroCol: string | null = null;
  let tnsFechaCol: string | null = null;
  let tnsMap = new Map<string, { fechaVto: string; tipo: string }>();

  if (tnsFile) {
    tnsRegistroCol = findColumn(tnsFile.columns, aliases.registro);
    tnsFechaCol = findColumn(tnsFile.columns, aliases.fechaVto);

    if (!tnsRegistroCol) {
      tnsRegistroCol = tnsFile.columns[0] || null;
      warnings.push(
        `TNS: No se encontró columna de registro conocida. Se usó "${tnsRegistroCol}" como clave.`
      );
    }
    if (!tnsFechaCol) {
      warnings.push('TNS: No se encontró columna de fecha.');
    }

    if (tnsRegistroCol) {
      // Skip metadata rows after header: letras=1, pagos=3 (account codes, saldo anterior, etc.)
      const rowsToSkip = modulo === 'letras' ? 1 : modulo === 'pagos' ? 3 : 0;
      let slicedRows = rowsToSkip > 0 ? tnsFile.rows.slice(rowsToSkip) : tnsFile.rows;

      // For pagos TNS: keep every other row (1 yes, 1 no — real data rows alternate with detail rows)
      if (modulo === 'pagos') {
        slicedRows = slicedRows.filter((_, i) => i % 2 === 0);
      }

      const tnsParsed = { ...tnsFile, rows: slicedRows };
      tnsMap = buildMap(tnsParsed, tnsRegistroCol, tnsFechaCol, tipoDefault);
    }
  }

  // ---- Build rows ----
  const rows: RegistroRow[] = [];

  if (modulo === 'letras') {
    // Substring matching: gestorKey is a substring of tnsKey
    // e.g. TNS: "NDLTSALINI1EHES37-1"  GESTOR: "SALINI1EHES37"
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

  } else {
    // Substring matching for pagos: gestorKey (RECIBO) is a substring of tnsKey (COMPROBANTE/TIPO DCTO value)
    const matchedGestorKeysPagos = new Set<string>();

    // 1. TNS keys first
    for (const tnsKey of tnsMap.keys()) {
      const tnsData = tnsMap.get(tnsKey)!;

      let matchedGestorKey: string | undefined;
      for (const gestorKey of gestorMap.keys()) {
        if (tnsKey.includes(gestorKey)) {
          matchedGestorKey = gestorKey;
          break;
        }
      }

      const inGestor = !!matchedGestorKey;
      if (inGestor) matchedGestorKeysPagos.add(matchedGestorKey!);

      const gestorData = matchedGestorKey ? gestorMap.get(matchedGestorKey) : undefined;
      const tipo = gestorData?.tipo ?? tnsData.tipo;
      const fechaVto = gestorData?.fechaVto || tnsData.fechaVto || '';
      const estado: RegistroRow['estadoConciliacion'] = inGestor ? 'Ambos' : 'Solo TNS';

      rows.push({ registro: tnsKey, tipo, fechaVto, gestor: inGestor, tns: true, estadoConciliacion: estado, modulo });
    }

    // 2. GESTOR-only rows
    for (const [gestorKey, gestorData] of gestorMap.entries()) {
      if (!matchedGestorKeysPagos.has(gestorKey)) {
        rows.push({ registro: gestorKey, tipo: gestorData.tipo, fechaVto: gestorData.fechaVto, gestor: true, tns: false, estadoConciliacion: 'Solo Gestor', modulo });
      }
    }
  }

  // No sorting — rows appear in the order found in the source files

  return {
    rows,
    columnInfo: {
      gestor: { registro: gestorRegistroCol, fechaVto: gestorFechaCol },
      tns: { registro: tnsRegistroCol, fechaVto: tnsFechaCol },
    },
    warnings,
  };
}
