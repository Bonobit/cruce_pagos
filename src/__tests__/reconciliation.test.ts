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
      [
        { 'COMPROBANTE/ TIPO DCTO': 'M1', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'M2', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'M3', FECHA: '' },
        { 'COMPROBANTE/ TIPO DCTO': 'PREFIJO-R100-X', FECHA: '2025-01-10' },
        { 'COMPROBANTE/ TIPO DCTO': 'DETALLE', FECHA: '' },
      ],
      ['COMPROBANTE/ TIPO DCTO', 'FECHA']
    );
    const result = reconcile('pagos', gestor, [tns]);
    const ambos = result.rows.filter((r) => r.estadoConciliacion === 'Ambos');
    expect(ambos).toHaveLength(1);
    expect(ambos[0].registro).toBe('R100'); // Original case from Gestor
  });

  it('concilia con robustez ante caracteres especiales (¿)', () => {
    const gestor = makeParsed(
      [{ 'NUMERO': 'SALINI¿r', FECHA: '2025-01-10' }],
      ['NUMERO', 'FECHA']
    );
    const tns = makeParsed(
      [{ 'DOCUMENTO': 'CRSALINI¿r', FECHA: '2025-01-10' }],
      ['DOCUMENTO', 'FECHA']
    );
    
    const result = reconcile('letras', gestor, [tns]);
    const ambos = result.rows.filter((r) => r.estadoConciliacion === 'Ambos');
    expect(ambos).toHaveLength(1);
    expect(ambos[0].registro).toBe('SALINI¿r'); // Preserva el símbolo original
  });

  it('usa fallback de OCR (L vs I, O vs 0) solo si falla el match simple', () => {
    const gestor = makeParsed(
      [{ 'NUMERO': 'SALINI1', FECHA: '2025-01-10' }],
      ['NUMERO', 'FECHA']
    );
    const tns = makeParsed(
      [{ 'DOCUMENTO': 'SALINIL', FECHA: '2025-01-10' }],
      ['DOCUMENTO', 'FECHA']
    );
    
    const result = reconcile('letras', gestor, [tns]);
    const ambos = result.rows.filter((r) => r.estadoConciliacion === 'Ambos');
    expect(ambos).toHaveLength(1);
    expect(ambos[0].registro).toBe('SALINI1'); // Match por robustNormalize fallback
  });

  it('no confunde O con 0 en casos normales', () => {
    const gestor = makeParsed(
      [{ 'NUMERO': 'ID-O', FECHA: '2025-01-01' }],
      ['NUMERO', 'FECHA']
    );
    const tns = makeParsed(
      [{ 'DOCUMENTO': 'ID-0', FECHA: '2025-01-01' }],
      ['DOCUMENTO', 'FECHA']
    );
    
    const result = reconcile('letras', gestor, [tns]);
    // Aunque robustNormalize los cruzaría, probamos que el displayKey sea el original
    const ambos = result.rows.filter((r) => r.estadoConciliacion === 'Ambos');
    expect(ambos).toHaveLength(1);
    expect(ambos[0].registro).toBe('ID-O'); // Sigue siendo O en el display
  });
});
