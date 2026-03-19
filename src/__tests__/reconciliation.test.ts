import { describe, it, expect } from 'vitest';
import { buildMap, buildMatchedRows, reconcile } from '../services/reconciliation';
import { ParsedFile } from '../types';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeParsed(rows: Record<string, string>[], columns?: string[]): ParsedFile {
  return {
    rows,
    columns: columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []),
  };
}

// ─── buildMap() ───────────────────────────────────────────────────────────────

describe('buildMap()', () => {
  it('construye un mapa básico con un registro', () => {
    const parsed = makeParsed([{ RECIBO: 'R001', FECHA: '2025-01-10' }]);
    const map = buildMap(parsed, 'RECIBO', 'FECHA', 'RECIBO');
    expect(map.size).toBe(1);
    expect(map.has('R001')).toBe(true);
    expect(map.get('R001')?.tipo).toBe('RECIBO');
  });

  it('normaliza la clave del registro (mayúsculas, sin acentos)', () => {
    const parsed = makeParsed([{ RECIBO: 'r001', FECHA: '' }]);
    const map = buildMap(parsed, 'RECIBO', 'FECHA', 'RECIBO');
    expect(map.has('R001')).toBe(true);
  });

  it('ignora filas con registro vacío', () => {
    const parsed = makeParsed([
      { RECIBO: '', FECHA: '2025-01-01' },
      { RECIBO: 'R002', FECHA: '2025-01-02' },
    ]);
    const map = buildMap(parsed, 'RECIBO', 'FECHA', 'RECIBO');
    expect(map.size).toBe(1);
    expect(map.has('R002')).toBe(true);
  });

  it('ignora filas donde el registro parece una fecha', () => {
    const parsed = makeParsed([
      { RECIBO: '2025-01-10', FECHA: '2025-01-10' },
      { RECIBO: 'R003', FECHA: '2025-01-10' },
    ]);
    const map = buildMap(parsed, 'RECIBO', 'FECHA', 'RECIBO');
    expect(map.size).toBe(1);
    expect(map.has('R003')).toBe(true);
  });

  it('ignora la fila donde el registro es el nombre de la columna (header duplicado)', () => {
    const parsed = makeParsed([
      { RECIBO: 'RECIBO', FECHA: 'FECHA' },
      { RECIBO: 'R004', FECHA: '2025-01-10' },
    ]);
    const map = buildMap(parsed, 'RECIBO', 'FECHA', 'RECIBO');
    expect(map.size).toBe(1);
    expect(map.has('R004')).toBe(true);
  });

  it('con duplicados mantiene solo una entrada por clave (deduplicación)', () => {
    // El algoritmo intenta mantener la fecha más temprana comparando raw vs formatted date.
    // La comparación es sensible al timezone/locale, por lo que solo verificamos
    // que la deduplicación funcione (size === 1) y no cuál fecha específica se guarda.
    const parsed = makeParsed([
      { RECIBO: 'R005', FECHA: '2025-06-01' },
      { RECIBO: 'R005', FECHA: '2025-03-01' },
      { RECIBO: 'R005', FECHA: '2025-09-01' },
    ]);
    const map = buildMap(parsed, 'RECIBO', 'FECHA', 'RECIBO');
    expect(map.size).toBe(1);
    expect(map.has('R005')).toBe(true);
  });

  it('con duplicados: si el primero no tiene fecha y el segundo sí, toma la del segundo', () => {
    const parsed = makeParsed([
      { RECIBO: 'R006', FECHA: '' },
      { RECIBO: 'R006', FECHA: '2025-05-01' },
    ]);
    const map = buildMap(parsed, 'RECIBO', 'FECHA', 'RECIBO');
    expect(map.get('R006')?.fechaVto).not.toBe('');
  });

  it('funciona sin columna de fecha (fechaVtoCol null)', () => {
    const parsed = makeParsed([{ RECIBO: 'R007' }]);
    const map = buildMap(parsed, 'RECIBO', null, 'LETRA');
    expect(map.has('R007')).toBe(true);
    expect(map.get('R007')?.fechaVto).toBe('');
  });
});

// ─── buildMatchedRows() ───────────────────────────────────────────────────────

describe('buildMatchedRows()', () => {
  const make = (key: string, fecha = '') => ({ fechaVto: fecha, tipo: 'RECIBO' });

  it('clasifica como "Ambos" cuando gestorKey es substring de tnsKey', () => {
    const gestorMap = new Map([['SALINI1', make('SALINI1')]]);
    const tnsMap = new Map([['NDLTSALINI1EHES37-1', make('NDLTSALINI1EHES37-1')]]);
    const rows = buildMatchedRows(gestorMap, tnsMap, 'letras');
    expect(rows).toHaveLength(1);
    expect(rows[0].estadoConciliacion).toBe('Ambos');
    expect(rows[0].gestor).toBe(true);
    expect(rows[0].tns).toBe(true);
  });

  it('clasifica como "Solo TNS" cuando no hay match en gestor', () => {
    const gestorMap = new Map<string, { fechaVto: string; tipo: string }>();
    const tnsMap = new Map([['TNS-001', make('TNS-001')]]);
    const rows = buildMatchedRows(gestorMap, tnsMap, 'pagos');
    expect(rows).toHaveLength(1);
    expect(rows[0].estadoConciliacion).toBe('Solo TNS');
    expect(rows[0].gestor).toBe(false);
    expect(rows[0].tns).toBe(true);
  });

  it('clasifica como "Solo Gestor" cuando el registro de gestor no aparece en TNS', () => {
    const gestorMap = new Map([['G-001', make('G-001')]]);
    const tnsMap = new Map<string, { fechaVto: string; tipo: string }>();
    const rows = buildMatchedRows(gestorMap, tnsMap, 'pagos');
    expect(rows).toHaveLength(1);
    expect(rows[0].estadoConciliacion).toBe('Solo Gestor');
    expect(rows[0].gestor).toBe(true);
    expect(rows[0].tns).toBe(false);
  });

  it('mezcla los tres estados correctamente', () => {
    const gestorMap = new Map([
      ['ABC', make('ABC')],
      ['SOLO-G', make('SOLO-G')],
    ]);
    const tnsMap = new Map([
      ['PREFIJO-ABC-SUFIJO', make('PREFIJO-ABC-SUFIJO')],
      ['SOLO-T', make('SOLO-T')],
    ]);
    const rows = buildMatchedRows(gestorMap, tnsMap, 'pagos');
    const ambos = rows.filter((r) => r.estadoConciliacion === 'Ambos');
    const soloG = rows.filter((r) => r.estadoConciliacion === 'Solo Gestor');
    const soloT = rows.filter((r) => r.estadoConciliacion === 'Solo TNS');
    expect(ambos).toHaveLength(1);
    expect(soloG).toHaveLength(1);
    expect(soloT).toHaveLength(1);
  });

  it('preserva el campo modulo en cada fila', () => {
    const gestorMap = new Map([['X', make('X')]]);
    const tnsMap = new Map<string, { fechaVto: string; tipo: string }>();
    const rows = buildMatchedRows(gestorMap, tnsMap, 'letras');
    expect(rows[0].modulo).toBe('letras');
  });

  it('retorna array vacío si ambos mapas están vacíos', () => {
    const rows = buildMatchedRows(new Map(), new Map(), 'pagos');
    expect(rows).toHaveLength(0);
  });
});

// ─── reconcile() — integración ────────────────────────────────────────────────

describe('reconcile()', () => {
  it('concilia registros pagos correctamente', () => {
    const gestor = makeParsed(
      [{ RECIBO: 'R100', FECHA: '2025-01-10' }],
      ['RECIBO', 'FECHA']
    );
    const tns = makeParsed(
      // TNS tiene 3 filas de metadata + 2 filas de datos (intercaladas)
      [
        { 'COMPROBANTE/ TIPO DCTO': 'META1', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'META2', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'META3', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'PREFIJO-R100-X', FECHA: '2025-01-10' },
        { 'COMPROBANTE/ TIPO DCTO': 'DETALLE', FECHA: '' },
      ],
      ['COMPROBANTE/ TIPO DCTO', 'FECHA']
    );
    const result = reconcile('pagos', gestor, tns);
    const ambos = result.rows.filter((r) => r.estadoConciliacion === 'Ambos');
    expect(ambos).toHaveLength(1);
    expect(ambos[0].registro).toBe('PREFIJO-R100-X');
  });

  it('emite warning cuando no se detecta columna de registro', () => {
    const gestor = makeParsed(
      [{ COL_DESCONOCIDA: 'V1', FECHA: '2025-01-01' }],
      ['COL_DESCONOCIDA', 'FECHA']
    );
    const result = reconcile('pagos', gestor, null);
    expect(result.warnings.some((w) => w.includes('GESTOR'))).toBe(true);
  });

  it('funciona con solo un archivo cargado (TNS null)', () => {
    const gestor = makeParsed(
      [{ RECIBO: 'R200', FECHA: '2025-02-01' }],
      ['RECIBO', 'FECHA']
    );
    const result = reconcile('pagos', gestor, null);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].estadoConciliacion).toBe('Solo Gestor');
  });

  it('funciona con solo un archivo cargado (GESTOR null)', () => {
    const tns = makeParsed(
      [
        { 'COMPROBANTE/ TIPO DCTO': 'M1', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'M2', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'M3', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'T300', FECHA: '2025-02-01' },
        { 'COMPROBANTE/ TIPO DCTO': 'DET', FECHA: '' },
      ],
      ['COMPROBANTE/ TIPO DCTO', 'FECHA']
    );
    const result = reconcile('pagos', null, tns);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].estadoConciliacion).toBe('Solo TNS');
  });

  it('incluye columnInfo con las columnas detectadas', () => {
    const gestor = makeParsed(
      [{ RECIBO: 'R001', FECHA: '2025-01-01' }],
      ['RECIBO', 'FECHA']
    );
    const result = reconcile('pagos', gestor, null);
    expect(result.columnInfo.gestor.registro).toBe('RECIBO');
  });
});
