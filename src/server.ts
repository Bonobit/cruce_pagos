import express from 'express';
import path from 'path';
import cors from 'cors';
import apiRouter from './routes/api';
import { logger } from './utils/logger';
import { exec } from 'child_process';
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
    console.log(`\n\x1b[32m[LISTO]\x1b[0m Aplicación ejecutándose en: http://localhost:${PORT}`);
    console.log(`\x1b[33m[INFO]\x1b[0m Si el navegador no se abre automáticamente, por favor visita la URL anterior.\n`);
    
    // Abrir el navegador con un pequeño retraso para asegurar que el server esté listo
    setTimeout(() => {
      if (process.platform === 'win32') {
        // 'start' con "" es la forma estándar de abrir URLs en Windows
        exec(`start "" "http://localhost:${PORT}"`);
      } else if (process.platform === 'darwin') {
        exec(`open "http://localhost:${PORT}"`);
      } else {
        exec(`xdg-open "http://localhost:${PORT}"`);
      }
    }, 1000);
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
