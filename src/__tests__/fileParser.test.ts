import { describe, it, expect } from 'vitest';
import { normalize, findColumn, formatDate } from '../services/fileParser';

// ─── normalize() ─────────────────────────────────────────────────────────────

describe('normalize()', () => {
  it('convierte a mayúsculas', () => {
    expect(normalize('hola')).toBe('HOLA');
  });

  it('elimina acentos', () => {
    expect(normalize('número')).toBe('NUMERO');
    expect(normalize('GESTIÓN')).toBe('GESTION');
    expect(normalize('vencimientó')).toBe('VENCIMIENTO');
  });

  it('recorta espacios extremos', () => {
    expect(normalize('  hola  ')).toBe('HOLA');
  });

  it('colapsa espacios internos múltiples', () => {
    expect(normalize('fecha   vto')).toBe('FECHA VTO');
  });

  it('maneja null', () => {
    expect(normalize(null)).toBe('');
  });

  it('maneja undefined', () => {
    expect(normalize(undefined)).toBe('');
  });

  it('maneja números', () => {
    expect(normalize(12345)).toBe('12345');
  });

  it('maneja string vacío', () => {
    expect(normalize('')).toBe('');
  });
});

// ─── findColumn() ─────────────────────────────────────────────────────────────

describe('findColumn()', () => {
  const columns = ['RECIBO', 'FECHA DE PAGO', 'MONTO'];

  it('encuentra columna por coincidencia exacta (case-insensitive)', () => {
    expect(findColumn(columns, ['recibo'])).toBe('RECIBO');
  });

  it('encuentra columna por el primer alias que coincide', () => {
    expect(findColumn(columns, ['NRO', 'RECIBO'])).toBe('RECIBO');
  });

  it('devuelve null si ningún alias coincide', () => {
    expect(findColumn(columns, ['COMPROBANTE', 'ID'])).toBeNull();
  });

  it('es resistente a acentos en los alias', () => {
    // columna tiene tilde, alias no
    const cols = ['NÚMERO'];
    expect(findColumn(cols, ['NUMERO'])).toBe('NÚMERO');
  });

  it('devuelve null con columnas vacías', () => {
    expect(findColumn([], ['RECIBO'])).toBeNull();
  });
});

// ─── formatDate() ─────────────────────────────────────────────────────────────

describe('formatDate()', () => {
  it('formatea una fecha ISO válida', () => {
    const input = '2025-03-15';
    const result = formatDate(input);
    // Calculamos el expected con la misma lógica para evitar depender del timezone del entorno
    const expected = new Date(input).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    expect(result).toBe(expected);
    expect(result).toMatch(/2025/);
  });

  it('retorna string vacío para valor vacío', () => {
    expect(formatDate('')).toBe('');
  });

  it('retorna el valor original si no es una fecha válida', () => {
    expect(formatDate('no-es-fecha')).toBe('no-es-fecha');
  });

  it('retorna string vacío para string de solo espacios', () => {
    expect(formatDate('   ')).toBe('');
  });
});
