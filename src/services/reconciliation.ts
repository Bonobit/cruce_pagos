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

  for (const row of parsed.rows) {
    const reg = normalize(row[registroCol]);
    if (!reg) continue;

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
      tnsMap = buildMap(tnsFile, tnsRegistroCol, tnsFechaCol, tipoDefault);
    }
  }

  // ---- Build union of all registros ----
  const allRegistros = new Set<string>([...gestorMap.keys(), ...tnsMap.keys()]);

  const rows: RegistroRow[] = [];

  for (const reg of allRegistros) {
    const inGestor = gestorMap.has(reg);
    const inTns = tnsMap.has(reg);

    // Prefer GESTOR data for tipo and fechaVto; fallback to TNS
    const gestorData = gestorMap.get(reg);
    const tnsData = tnsMap.get(reg);

    const tipo = gestorData?.tipo ?? tnsData?.tipo ?? tipoDefault;
    const fechaVto = gestorData?.fechaVto || tnsData?.fechaVto || '';

    const estado: RegistroRow['estadoConciliacion'] =
      inGestor && inTns ? 'Ambos' : inGestor ? 'Solo Gestor' : 'Solo TNS';

    rows.push({ registro: reg, tipo, fechaVto, gestor: inGestor, tns: inTns, estadoConciliacion: estado });
  }

  // Sort: Ambos first, then Solo Gestor, then Solo TNS; then alphabetically
  const order: Record<string, number> = { Ambos: 0, 'Solo Gestor': 1, 'Solo TNS': 2 };
  rows.sort((a, b) => {
    const eo = order[a.estadoConciliacion] - order[b.estadoConciliacion];
    if (eo !== 0) return eo;
    return a.registro.localeCompare(b.registro);
  });

  return {
    rows,
    columnInfo: {
      gestor: { registro: gestorRegistroCol, fechaVto: gestorFechaCol },
      tns: { registro: tnsRegistroCol, fechaVto: tnsFechaCol },
    },
    warnings,
  };
}
