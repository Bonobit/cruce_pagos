import { describe, it, expect } from 'vitest';
import { reconcile } from '../services/reconciliation';
import { ParsedFile } from '../types';
import { AppError } from '../utils/errors';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeParsed(rows: Record<string, string>[], columns?: string[]): ParsedFile {
  return {
    rows,
    columns: columns ?? (rows.length > 0 ? Object.keys(rows[0]) : []),
  };
}

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
    const result = reconcile('pagos', gestor, [tns]);
    const ambos = result.rows.filter((r) => r.estadoConciliacion === 'Ambos');
    expect(ambos).toHaveLength(1);
    expect(ambos[0].registro).toBe('PREFIJO-R100-X');
  });

  it('lanza error cuando no se detecta columna válida de registro', () => {
    const gestor = makeParsed(
      [{ COL_DESCONOCIDA: 'V1', FECHA: '2025-01-01' }],
      ['COL_DESCONOCIDA', 'FECHA']
    );
    expect(() => reconcile('pagos', gestor, [])).toThrowError(AppError);
  });

  it('funciona con solo un archivo cargado (TNS null)', () => {
    const gestor = makeParsed(
      [{ RECIBO: 'R200', FECHA: '2025-02-01' }],
      ['RECIBO', 'FECHA']
    );
    const result = reconcile('pagos', gestor, []);
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
    const result = reconcile('pagos', null, [tns]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].estadoConciliacion).toBe('Solo TNS');
  });

  it('incluye columnInfo con las columnas detectadas', () => {
    const gestor = makeParsed(
      [{ RECIBO: 'R001', FECHA: '2025-01-01' }],
      ['RECIBO', 'FECHA']
    );
    const result = reconcile('pagos', gestor, []);
    expect(result.columnInfo.gestor.registro).toBe('RECIBO');
  });
});

