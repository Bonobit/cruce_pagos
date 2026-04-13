import './utils/polyfills';
import { initAssets, TEMP_DIR } from './utils/assets';

// Initialize assets (extract from SEA if needed) as early as possible
initAssets();

// Add temp dir to module paths so Node can find extracted native modules
(module as any).paths.push(TEMP_DIR);

import express from 'express';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import apiRouter from './routes/api';
import { logger } from './utils/logger';
import { exec, spawn, execSync } from 'child_process';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Setup static paths carefully for pkg and SEA
// @ts-ignore
const nodeSea = (process as any).getBuiltinModule ? (process as any).getBuiltinModule('node:sea') : null;
const isPkg = typeof (process as any).pkg !== 'undefined';
const isSea = !isPkg && !!(nodeSea && nodeSea.isSea());

/**
 * Mata procesos que estén usando el puerto 3000 para evitar conflictos
 */
function killPreviousInstance() {
  try {
    const stdout = execSync(`netstat -ano | findstr :${PORT}`).toString();
    const lines = stdout.split('\n');
    const currentPid = process.pid;

    for (const line of lines) {
      if (!line.includes('LISTENING')) continue;
      
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1]);
      
      if (pid && pid !== currentPid) {
        logger.info({ pid }, 'Cerrando instancia previa detectada en el puerto 3000');
        try {
          execSync(`taskkill /F /PID ${pid}`);
        } catch (e) {
          // Ignorar errores al matar (puede que ya se haya cerrado)
        }
      }
    }
  } catch (err) {
    // Si falla es generalmente porque no hay procesos en ese puerto
  }
}

/**
 * Lanza la aplicación en segundo plano si no tiene el flag --background
 */
function checkBackground() {
  if (process.argv.includes('--background')) return;

  if (process.platform === 'win32' && (isSea || isPkg)) {
    const vbsPath = path.join(TEMP_DIR, 'launcher.vbs');
    const exePath = `"${process.execPath}"`;
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run ${exePath} & " --background", 0, False`;
    
    try {
      fs.writeFileSync(vbsPath, vbsContent);
      spawn('cscript.exe', ['//Nologo', vbsPath], {
        detached: true,
        stdio: 'ignore'
      }).unref();
      
      logger.info('Iniciando en segundo plano, cerrando consola...');
      process.exit(0);
    } catch (err) {
      logger.error('Error al intentar lanzar en segundo plano:', err);
    }
  }
}

// Lógica de arranque (Solo en el ejecutable)
if (isSea || isPkg) {
  killPreviousInstance();
  checkBackground();
}

let publicPath = path.join(__dirname, '..', 'public');

if (isSea) {
  // En SEA, preferimos la carpeta extraída en %TEMP% para que sea 100% independiente
  const tempPublic = path.join(TEMP_DIR, 'public');
  if (fs.existsSync(tempPublic)) {
    publicPath = tempPublic;
  }
} else if (isPkg) {
  const nextToExe = path.join(path.dirname(process.execPath), 'public');
  const levelUp = path.join(path.dirname(process.execPath), '..', 'public');
  
  if (fs.existsSync(nextToExe)) {
    publicPath = nextToExe;
  } else if (fs.existsSync(levelUp)) {
    publicPath = levelUp;
  }
}

logger.info({ isPkg, isSea, __dirname, execPath: process.execPath, publicPath }, 'Iniciando servidor...');

app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(publicPath));

// API routes
app.use('/api', apiRouter);

// Fallback to index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

async function startServer() {
  try {
    logger.info(`Iniciando servidor en el puerto ${PORT}...`);
    
    // Eliminamos killPort para evitar conflictos de permisos con ejecutables binarios
    // El usuario debe asegurarse de que el puerto esté libre.

    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, 'Servidor escuchando con éxito');
      console.log(`\n\x1b[32m[LISTO]\x1b[0m Aplicación ejecutándose en: http://localhost:${PORT}`);
      console.log(`\x1b[33m[INFO]\x1b[0m Si el navegador no se abre automáticamente, visita la URL anterior.\n`);
      
      setTimeout(() => {
        try {
          if (process.platform === 'win32') {
            exec(`start "" "http://localhost:${PORT}"`);
          } else if (process.platform === 'darwin') {
            exec(`open "http://localhost:${PORT}"`);
          } else {
            exec(`xdg-open "http://localhost:${PORT}"`);
          }
        } catch (e) {
          logger.error('No se pudo abrir el navegador automáticamente.');
        }
      }, 1500);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\x1b[31m[ERROR]\x1b[0m El puerto ${PORT} está ocupado por otra aplicación.`);
        console.error(`Cierra cualquier otra instancia de esta app e inténtalo de nuevo.`);
        if (isPkg) {
          console.log('\nPresiona cualquier tecla para salir...');
          process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.on('data', () => process.exit(1));
        } else {
          process.exit(1);
        }
      } else {
        logger.error({ err }, 'Error inesperado al iniciar el servidor');
        process.exit(1);
      }
    });

  } catch (fatal) {
    console.error('\n\x1b[31m[ERROR FATAL]\x1b[0m No se pudo iniciar la aplicación:');
    console.error(fatal);
    if (isPkg) {
      console.log('\nPresiona cualquier tecla para salir...');
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', () => process.exit(1));
    } else {
      process.exit(1);
    }
  }
}

startServer();

export default app;
