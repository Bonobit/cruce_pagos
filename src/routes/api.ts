import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { Modulo, Store, StoreEntry } from '../types';
import { parseFile, parseFileOrPdf } from '../services/fileParser';
import { reconcile } from '../services/reconciliation';
import { generateExcel } from '../services/excelExport';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';

const router = Router();

// In-memory store keyed by modulo
const store: Store = {
  pagos: { gestor: null, tns: [] },
  letras: { gestor: null, tns: [] },
};

// Multer: memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'application/octet-stream',
      'application/pdf',
    ];
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ['xls', 'xlsx', 'csv', 'pdf'].includes(ext ?? '')) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no soportado: ${file.mimetype}`));
    }
  },
});

export const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: any) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: { code: 'ERR_FILE_TOO_LARGE', message: 'El archivo supera el límite de 20 MB permitido.' } });
      return;
    } else if (err) {
      res.status(400).json({ error: { code: 'ERR_FILE_CORRUPT', message: `Error en la subida: ${err.message}` } });
      return;
    }
    next();
  });
};

const handleError = (err: any, res: Response, source?: string) => {
  if (err instanceof AppError) {
    if (source) logger.warn({ source, code: err.code }, err.message);
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  } else {
    if (source) logger.error({ source, err }, 'Error inesperado');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: `Error inesperado: ${(err as Error).message}` } });
  }
};

function getModulo(req: Request): Modulo | null {
  const m = req.query.modulo as string;
  if (m === 'pagos' || m === 'letras') return m;
  return null;
}

function getStore(modulo: Modulo): StoreEntry {
  return store[modulo];
}

// ─── Upload GESTOR ────────────────────────────────────────────────────────────
router.post('/upload/gestor', uploadMiddleware, async (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: { code: 'INTERNAL_ERROR', message: 'Parámetro modulo requerido: pagos | letras' } });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Archivo requerido' } });
    return;
  }
  try {
    const parsed = await parseFileOrPdf(req.file.buffer, req.file.originalname);
    getStore(modulo).gestor = parsed;
    logger.info({ modulo, source: 'gestor', rows: parsed.rows.length }, 'Archivo cargado');
    res.json({
      ok: true,
      modulo,
      source: 'gestor',
      rows: parsed.rows.length,
      columns: parsed.columns,
    });
  } catch (err) {
    handleError(err, res, 'gestor');
  }
});

// ─── Upload TNS (múltiples archivos — cada llamada agrega al array) ───────────
router.post('/upload/tns', uploadMiddleware, (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: { code: 'INTERNAL_ERROR', message: 'Parámetro modulo requerido: pagos | letras' } });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Archivo requerido' } });
    return;
  }
  try {
    const parsed = parseFile(req.file.buffer, req.file.originalname);

    // Agregar al array de TNS (permite múltiples archivos)
    getStore(modulo).tns.push(parsed);

    const rawCount = parsed.rows.length;
    let effectiveCount = rawCount;
    if (modulo === 'letras') {
      effectiveCount = Math.max(0, rawCount - 1);
    } else if (modulo === 'pagos') {
      const afterSkip = Math.max(0, rawCount - 3);
      effectiveCount = Math.floor(afterSkip / 2);
    }

    const totalTnsFiles = getStore(modulo).tns.length;
    logger.info({ modulo, source: 'tns', rows: effectiveCount, totalFiles: totalTnsFiles }, 'Archivo TNS agregado');
    res.json({
      ok: true,
      modulo,
      source: 'tns',
      rows: effectiveCount,
      columns: parsed.columns,
      totalTnsFiles,
    });
  } catch (err) {
    handleError(err, res, 'tns');
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────
router.get('/status', (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: { code: 'INTERNAL_ERROR', message: 'Parámetro modulo requerido' } });
    return;
  }
  const s = getStore(modulo);
  res.json({
    modulo,
    gestor: s.gestor ? { rows: s.gestor.rows.length, columns: s.gestor.columns } : null,
    tns: s.tns.length > 0
      ? { files: s.tns.length, totalRows: s.tns.reduce((acc, f) => acc + f.rows.length, 0) }
      : null,
  });
});

// ─── Cruce JSON ───────────────────────────────────────────────────────────────
router.get('/cruce', (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: { code: 'INTERNAL_ERROR', message: 'Parámetro modulo requerido' } });
    return;
  }
  const s = getStore(modulo);
  if (!s.gestor && s.tns.length === 0) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Debe cargar los archivos antes de generar el cruce.' } });
    return;
  }
  if (!s.gestor || s.tns.length === 0) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Falta cargar uno de los archivos para el módulo seleccionado (GESTOR o TNS).' } });
    return;
  }
  try {
    const result = reconcile(modulo, s.gestor, s.tns);
    logger.info({ modulo, totalRows: result.rows.length, warnings: result.warnings.length }, 'Cruce ejecutado');
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// ─── Debug: view raw columns from uploaded files ──────────────────────────────
router.get('/debug/columns', (_req: Request, res: Response) => {
  res.json({
    letras: {
      gestor: store.letras.gestor?.columns ?? null,
      tns: store.letras.tns.map(f => f.columns),
    },
    pagos: {
      gestor: store.pagos.gestor?.columns ?? null,
      tns: store.pagos.tns.map(f => f.columns),
    },
  });
});

// ─── Cruce ALL (Letras + Pagos separated) ─────────────────────────────────────
router.get('/cruce/all', (_req: Request, res: Response) => {
  const letrasStore = getStore('letras');
  const pagosStore = getStore('pagos');

  const hasLetrasAny = letrasStore.gestor || letrasStore.tns.length > 0;
  const hasPagosAny = pagosStore.gestor || pagosStore.tns.length > 0;

  if (!hasLetrasAny && !hasPagosAny) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Debe cargar los archivos antes de generar el cruce.' } });
    return;
  }

  if (hasLetrasAny && (!letrasStore.gestor || letrasStore.tns.length === 0)) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Faltan archivos en el módulo Letras (Gestor o TNS).' } });
    return;
  }

  if (hasPagosAny && (!pagosStore.gestor || pagosStore.tns.length === 0)) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Faltan archivos en el módulo Pagos (Gestor o TNS).' } });
    return;
  }

  try {
    const result: any = {};

    if (hasLetrasAny) {
      const r = reconcile('letras', letrasStore.gestor, letrasStore.tns);
      result.letras = { rows: r.rows, warnings: r.warnings, columnInfo: r.columnInfo };
    }
    if (hasPagosAny) {
      const r = reconcile('pagos', pagosStore.gestor, pagosStore.tns);
      result.pagos = { rows: r.rows, warnings: r.warnings, columnInfo: r.columnInfo };
    }

    const totalRows = (result.letras?.rows.length || 0) + (result.pagos?.rows.length || 0);
    const totalWarnings = (result.letras?.warnings.length || 0) + (result.pagos?.warnings.length || 0);
    logger.info({ letrasRows: result.letras?.rows.length || 0, pagosRows: result.pagos?.rows.length || 0, totalWarnings }, 'Cruce ALL ejecutado');
    res.json(result);
  } catch (err) {
    handleError(err, res);
  }
});

// ─── Cruce Excel Download (por módulo) ─────────────────────────────────────────
router.get('/cruce/excel', async (req: Request, res: Response) => {
  const modulo = (req.query.modulo as string); // 'letras', 'pagos', o undefined para ambos
  const letrasStore = getStore('letras');
  const pagosStore = getStore('pagos');

  const hasLetrasAny = letrasStore.gestor || letrasStore.tns.length > 0;
  const hasPagosAny = pagosStore.gestor || pagosStore.tns.length > 0;

  if (!hasLetrasAny && !hasPagosAny) {
    res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Debe cargar al menos un módulo completo antes de exportar.' } });
    return;
  }

  if (modulo === 'letras') {
    if (!hasLetrasAny) {
      res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'No hay datos de Letras para exportar.' } });
      return;
    }
    if (!letrasStore.gestor || letrasStore.tns.length === 0) {
      res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Faltan archivos en el módulo Letras.' } });
      return;
    }
  } else if (modulo === 'pagos') {
    if (!hasPagosAny) {
      res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'No hay datos de Pagos para exportar.' } });
      return;
    }
    if (!pagosStore.gestor || pagosStore.tns.length === 0) {
      res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Faltan archivos en el módulo Pagos.' } });
      return;
    }
  } else {
    // Sin modulo especificado: validar ambos si hay datos
    if (hasLetrasAny && (!letrasStore.gestor || letrasStore.tns.length === 0)) {
      res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Faltan archivos en el módulo Letras.' } });
      return;
    }
    if (hasPagosAny && (!pagosStore.gestor || pagosStore.tns.length === 0)) {
      res.status(400).json({ error: { code: 'ERR_MISSING_FILES', message: 'Faltan archivos en el módulo Pagos.' } });
      return;
    }
  }

  try {
    let rowsToExport: import('../types').RegistroRow[] = [];
    let filename = '';

    if (modulo === 'letras') {
      rowsToExport = reconcile('letras', letrasStore.gestor, letrasStore.tns).rows;
      filename = `cruce_letras_${new Date().toISOString().slice(0, 10)}.xlsx`;
    } else if (modulo === 'pagos') {
      rowsToExport = reconcile('pagos', pagosStore.gestor, pagosStore.tns).rows;
      filename = `cruce_pagos_${new Date().toISOString().slice(0, 10)}.xlsx`;
    } else {
      // Ambos módulos
      if (hasLetrasAny) rowsToExport = rowsToExport.concat(reconcile('letras', letrasStore.gestor, letrasStore.tns).rows);
      if (hasPagosAny) rowsToExport = rowsToExport.concat(reconcile('pagos', pagosStore.gestor, pagosStore.tns).rows);
      filename = `cruce_completo_${new Date().toISOString().slice(0, 10)}.xlsx`;
    }

    const buf = await generateExcel(rowsToExport, 'cruce');
    logger.info({ rows: rowsToExport.length, filename, modulo: modulo || 'ambos' }, 'Excel exportado');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    handleError(err, res);
  }
});

// ─── Cruce Excel Download filtrado (por módulo y filas visibles) ─────────────
router.post('/cruce/excel/filtered', async (req: Request, res: Response) => {
  const { modulo, rows } = req.body as { modulo?: string; rows?: unknown };
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: { code: 'ERR_MISSING_DATA', message: 'No se recibieron filas para exportar.' } });
    return;
  }

  const filename = `cruce_${modulo || 'filtrado'}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  try {
    // Asumimos que cada fila cumple con la forma RegistroRow
    const rowsToExport = rows as import('../types').RegistroRow[];
    const buf = await generateExcel(rowsToExport, 'cruce');

    logger.info({ rows: rowsToExport.length, filename, modulo: modulo || 'filtrado' }, 'Excel filtrado exportado');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    handleError(err, res);
  }
});

// ─── Clear / Reset ────────────────────────────────────────────────────────────
router.delete('/reset', (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: { code: 'INTERNAL_ERROR', message: 'Parámetro modulo requerido' } });
    return;
  }
  store[modulo] = { gestor: null, tns: [] };
  logger.info({ modulo }, 'Módulo reseteado');
  res.json({ ok: true, message: `Módulo ${modulo} limpiado.` });
});

export default router;