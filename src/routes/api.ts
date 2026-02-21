import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Modulo, Store, StoreEntry } from '../types';
import { parseFile } from '../services/fileParser';
import { reconcile } from '../services/reconciliation';
import { generateExcel } from '../services/excelExport';

const router = Router();

// In-memory store keyed by modulo
const store: Store = {
  pagos: { gestor: null, tns: null },
  letras: { gestor: null, tns: null },
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
    ];
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (allowed.includes(file.mimetype) || ['xls', 'xlsx', 'csv'].includes(ext ?? '')) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no soportado: ${file.mimetype}`));
    }
  },
});

function getModulo(req: Request): Modulo | null {
  const m = req.query.modulo as string;
  if (m === 'pagos' || m === 'letras') return m;
  return null;
}

function getStore(modulo: Modulo): StoreEntry {
  return store[modulo];
}

// ─── Upload GESTOR ────────────────────────────────────────────────────────────
router.post('/upload/gestor', upload.single('file'), (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: 'Parámetro modulo requerido: pagos | letras' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Archivo requerido' });
    return;
  }
  try {
    const parsed = parseFile(req.file.buffer, req.file.originalname);
    getStore(modulo).gestor = parsed;
    res.json({
      ok: true,
      modulo,
      source: 'gestor',
      rows: parsed.rows.length,
      columns: parsed.columns,
    });
  } catch (err) {
    res.status(500).json({ error: `Error al procesar archivo: ${(err as Error).message}` });
  }
});

// ─── Upload TNS ───────────────────────────────────────────────────────────────
router.post('/upload/tns', upload.single('file'), (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: 'Parámetro modulo requerido: pagos | letras' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'Archivo requerido' });
    return;
  }
  try {
    const parsed = parseFile(req.file.buffer, req.file.originalname);
    getStore(modulo).tns = parsed;
    const rawCount = parsed.rows.length;
    // Compute effective count matching the filters applied in reconciliation
    let effectiveCount = rawCount;
    if (modulo === 'letras') {
      effectiveCount = Math.max(0, rawCount - 1);          // skip first metadata row
    } else if (modulo === 'pagos') {
      const afterSkip = Math.max(0, rawCount - 3);         // skip 3 metadata rows
      effectiveCount = Math.floor(afterSkip / 2);           // keep every other row
    }
    res.json({
      ok: true,
      modulo,
      source: 'tns',
      rows: effectiveCount,
      columns: parsed.columns,
    });
  } catch (err) {
    res.status(500).json({ error: `Error al procesar archivo: ${(err as Error).message}` });
  }
});

// ─── Status ───────────────────────────────────────────────────────────────────
router.get('/status', (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: 'Parámetro modulo requerido' });
    return;
  }
  const s = getStore(modulo);
  res.json({
    modulo,
    gestor: s.gestor ? { rows: s.gestor.rows.length, columns: s.gestor.columns } : null,
    tns: s.tns ? { rows: s.tns.rows.length, columns: s.tns.columns } : null,
  });
});

// ─── Cruce JSON ───────────────────────────────────────────────────────────────
router.get('/cruce', (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: 'Parámetro modulo requerido' });
    return;
  }
  const s = getStore(modulo);
  if (!s.gestor && !s.tns) {
    res.status(400).json({ error: 'Debe cargar al menos un archivo antes de generar el cruce.' });
    return;
  }
  const result = reconcile(modulo, s.gestor, s.tns);
  res.json(result);
});

// ─── Debug: view raw columns from uploaded files ──────────────────────────────
router.get('/debug/columns', (req: Request, res: Response) => {
  res.json({
    letras: {
      gestor: store.letras.gestor?.columns ?? null,
      tns: store.letras.tns?.columns ?? null,
    },
    pagos: {
      gestor: store.pagos.gestor?.columns ?? null,
      tns: store.pagos.tns?.columns ?? null,
    },
  });
});

// ─── Cruce ALL (Letras + Pagos combined) ─────────────────────────────────────
router.get('/cruce/all', (req: Request, res: Response) => {
  const letrasStore = getStore('letras');
  const pagosStore = getStore('pagos');

  const hasLetras = letrasStore.gestor || letrasStore.tns;
  const hasPagos = pagosStore.gestor || pagosStore.tns;

  if (!hasLetras && !hasPagos) {
    res.status(400).json({ error: 'Debe cargar al menos un archivo en algún módulo.' });
    return;
  }

  const warnings: string[] = [];
  let combinedRows: import('../types').RegistroRow[] = [];

  if (hasLetras) {
    const r = reconcile('letras', letrasStore.gestor, letrasStore.tns);
    warnings.push(...r.warnings);
    combinedRows = combinedRows.concat(r.rows);
  }
  if (hasPagos) {
    const r = reconcile('pagos', pagosStore.gestor, pagosStore.tns);
    warnings.push(...r.warnings);
    combinedRows = combinedRows.concat(r.rows);
  }

  res.json({ rows: combinedRows, warnings });
});

// ─── Cruce Excel Download ──────────────────────────────────────────────────────
router.get('/cruce/excel', async (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: 'Parámetro modulo requerido' });
    return;
  }
  const s = getStore(modulo);
  if (!s.gestor && !s.tns) {
    res.status(400).json({ error: 'Debe cargar al menos un archivo antes de exportar.' });
    return;
  }
  try {
    const result = reconcile(modulo, s.gestor, s.tns);
    const buf = await generateExcel(result.rows, modulo);
    const filename = `cruce_${modulo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: `Error al generar Excel: ${(err as Error).message}` });
  }
});

// ─── Clear / Reset ────────────────────────────────────────────────────────────
router.delete('/reset', (req: Request, res: Response) => {
  const modulo = getModulo(req);
  if (!modulo) {
    res.status(400).json({ error: 'Parámetro modulo requerido' });
    return;
  }
  store[modulo] = { gestor: null, tns: null };
  res.json({ ok: true, message: `Módulo ${modulo} limpiado.` });
});

export default router;
