import express from 'express';
import path from 'path';
import cors from 'cors';
import apiRouter from './routes/api';
import { logger } from './utils/logger';
import { spawn } from 'child_process';
import open from 'open';
import killPort from 'kill-port';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', apiRouter);

// Fallback to index.html for SPA-style navigation
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

import { exec } from 'child_process';

// Envolvemos el puerto en un try catch nativo a nivel de app listen si es necesario,
// pero por ahora solo intentamos que abra el navegador si inicia con exito
async function startServer() {
  try {
    await killPort(PORT, 'tcp');
  } catch (err) {
    // Si falla ignoramos
  }

  const server = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Conciliación App iniciada');
    
    // Abrir el navegador forzando uso del explorador nativo de Windows (bulletproof para pkg)
    if (process.platform === 'win32') {
      exec(`explorer "http://localhost:${PORT}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "http://localhost:${PORT}"`);
    } else {
      exec(`xdg-open "http://localhost:${PORT}"`);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`El puerto ${PORT} sigue en uso pese a intentar liberarlo.`);
      process.exit(1);
    }
  });
}

startServer();

export default app;
