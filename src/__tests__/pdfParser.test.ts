import { describe, it, expect } from 'vitest';
import { parsePdfText } from '../services/pdfParser';
import { AppError } from '../utils/errors';

// ─── Texto simulado: Histórico de Pagos ───────────────────────────────────────
const HISTORICO_TEXT = `
HISTÓRICO DE PAGOS

Apreciado inversionista RAUL ROA

FECHA          FECHA DE PAGO   RECIBO   VALOR
30/03/2022     13/05/2022      28045    $3.671.000
30/04/2022     10/06/2022      29032    $3.671.000
30/05/2022     30/06/2022      29559    $3.671.000
TOTAL                                  $11.013.000

TENGA EN CUENTA QUE:
1. La información indicada corresponde a valores soportados desde 2017.
`;

// ─── Texto simulado: Pagos Pendientes ─────────────────────────────────────────
const PENDIENTES_TEXT = `
PAGOS PENDIENTES

Apreciado inversionista RAUL ROA

Fecha Vencimiento  Saldo         Número    Mora  Estado
2022/03/30         $3.671.000    SALINIa   $0    Pagada
2022/04/30         $3.671.000    SALINIb   $0    Pagada
2027/01/28         $119.447.500  SALINIr   $0    En espera de pago

TENGA EN CUENTA QUE:
`;

// ─── Texto simulado: TNS Cartera por Cuotas ──────────────────────────────────
const TNS_TEXT = `
PROMOTORA INMOBILIARIA PARDAL S.A.S. 1 de 2 páginas
900804160-6 Fecha: 04/04/2026 10:56 AM
CARTERA POR CUOTAS
Cliente Fec. Corte Sucursal
DOCUMENTO DETALLE CONCEPTO FECHA EMISION FECHA VCTO.
60309704 MARTA YANETH OMAÑA CARRILLO
NDLTSALINI1z1MlX
2-1
Anticipo NOGALES 1
ETAPA 01/01/2025 30/12/2025 95 100,000.00 100,000.00 5,510.00 105,510.00
NDLTSALINI1z1MlX
3-1
Anticipo NOGALES 1
ETAPA 01/01/2025 30/01/2026 64 100,000.00 100,000.00 3,712.00 103,712.00
`;

// ─── Texto simulado: TNS Libro Auxiliar ──────────────────────────────────────
const LIBRO_TEXT = `
PROMOTORA INMOBILIARIA PARDAL S.A.S.
900804160-6
LIBRO AUXILIAR
FECHA COMPROBANTE/ TIPO DCTO TERCERO/DETALLE DEBE HABER
27/11/2025 RCCG73608 PAGO CUOTA MES DE NOVIEMBRE 0.00 500,000.00
NDLTSALINI1z1MIX1
`;

describe('parsePdfText', () => {
  it('parsea Histórico de Pagos correctamente', () => {
    const result = parsePdfText(HISTORICO_TEXT, 'historico.pdf');
    expect(result.columns).toEqual(['FECHA', 'FECHA DE PAGO', 'RECIBO', 'VALOR']);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0]['RECIBO']).toBe('28045');
    expect(result.rows[0]['FECHA']).toBe('30/03/2022');
    expect(result.isPdf).toBe(true);
  });

  it('parsea Pagos Pendientes correctamente', () => {
    const result = parsePdfText(PENDIENTES_TEXT, 'pendientes.pdf');
    expect(result.columns).toEqual(['FECHA VENCIMIENTO', 'SALDO', 'NUMERO', 'MORA', 'ESTADO']);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0]['NUMERO']).toBe('SALINIa');
    expect(result.isPdf).toBe(true);
  });

  it('parsea TNS Cartera por Cuotas correctamente', () => {
    const result = parsePdfText(TNS_TEXT, 'tns.pdf');
    expect(result.rows.length).toBe(2);
    expect(result.rows[0]['DOCUMENTO']).toBe('NDLTSALINI1z1MlX');
    expect(result.rows[0]['FECHA VENCIMIENTO']).toBe('30/12/2025');
    expect(result.isPdf).toBe(true);
  });

  it('parsea TNS Libro Auxiliar correctamente', () => {
    const result = parsePdfText(LIBRO_TEXT, 'libro.pdf');
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]['COMPROBANTE/TIPO DCTO']).toBe('RCCG73608');
    expect(result.rows[0]['FECHA']).toBe('27/11/2025');
    expect(result.rows[0]['HABER']).toBe('500000.00');
    expect(result.isPdf).toBe(true);
  });

  it('lanza AppError si el texto no contiene tabla reconocida', () => {
    expect(() => parsePdfText('Documento sin tablas conocidas', 'otro.pdf')).toThrow(AppError);
  });
});
