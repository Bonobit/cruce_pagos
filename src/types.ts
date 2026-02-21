export type Modulo = 'pagos' | 'letras';

export interface RegistroRow {
  registro: string;
  tipo: string;
  fechaVto: string;
  gestor: boolean;
  tns: boolean;
  estadoConciliacion: 'Solo Gestor' | 'Solo TNS' | 'Ambos';
  modulo: Modulo;
}

export interface ParsedFile {
  rows: Record<string, string>[];
  columns: string[];
}

export interface StoreEntry {
  gestor: ParsedFile | null;
  tns: ParsedFile | null;
}

export type Store = Record<Modulo, StoreEntry>;

// Column aliases for auto-detection (uppercase, no accents)
export const COLUMN_ALIASES = {
  pagos: {
    registro: ['RECIBO', 'REGISTRO', 'N°', 'NUMERO', 'NRO', 'NRO.', 'NO.', 'ID', 'COMPROBANTE', 'COMPROBANTE/ TIPO DCTO', 'COMPROBANTE/TIPO DCTO'],
    fechaVto: ['FECHA', 'FECHA DE PAGO', 'FECHA VTO', 'FECHA VENCIMIENTO', 'FEC VTO', 'VENCIMIENTO'],
  },
  letras: {
    registro: ['NUMERO', 'NÚMERO', 'N°', 'NRO', 'DOCUMENTO', 'REGISTRO', 'LETRA', 'ID', 'COMPROBANTE'],
    fechaVto: ['FECHA VENCIMIENTO', 'FECHA VTO', 'FECHA VCTO.', 'FECHA VCTO', 'FEC VTO', 'VENCIMIENTO', 'FECHA', 'FECHA DE VENCIMIENTO'],
  },
};
