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

describe('parsePdfText', () => {
  it('parsea Histórico de Pagos correctamente', () => {
    const result = parsePdfText(HISTORICO_TEXT, 'historico.pdf');

    expect(result.columns).toEqual(['FECHA', 'FECHA DE PAGO', 'RECIBO', 'VALOR']);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0]['RECIBO']).toBe('28045');
    expect(result.rows[0]['FECHA']).toBe('30/03/2022');
  });

  it('parsea Pagos Pendientes correctamente', () => {
    const result = parsePdfText(PENDIENTES_TEXT, 'pendientes.pdf');

    expect(result.columns).toEqual(['FECHA VENCIMIENTO', 'SALDO', 'NUMERO', 'MORA', 'ESTADO']);
    expect(result.rows.length).toBe(3);
    expect(result.rows[0]['NUMERO']).toBe('SALINIa');
    expect(result.rows[0]['FECHA VENCIMIENTO']).toBe('2022/03/30');
  });

  it('lanza AppError si el texto no contiene tabla reconocida', () => {
    expect(() => parsePdfText('Documento sin tablas conocidas', 'otro.pdf'))
      .toThrow(AppError);
  });

  it('lanza AppError si el texto está vacío', () => {
    expect(() => parsePdfText('   ', 'escaneado.pdf'))
      .toThrow(AppError);
  });

  it('el AppError tiene código ERR_FILE_CORRUPT', () => {
    try {
      parsePdfText('', 'vacio.pdf');
      expect.fail('debería haber lanzado');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('ERR_FILE_CORRUPT');
    }
  });
});
