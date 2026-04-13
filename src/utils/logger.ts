import fs from 'fs';
import path from 'path';

// Determinar la ruta del log (junto al ejecutable si estamos en SEA/Pkg)
const isBundled = typeof (process as any).pkg !== 'undefined' || 
                 (typeof (process as any).getBuiltinModule === 'function' && (process as any).getBuiltinModule('node:sea')?.isSea());

const logDir = isBundled 
  ? path.dirname(process.execPath) 
  : process.cwd();

const logFile = path.join(logDir, 'app.log');

/**
 * Escribe un mensaje en el archivo de log con timestamp
 */
function writeToFile(level: string, msg: any, ...args: any[]) {
  const timestamp = new Date().toISOString();
  let text = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  
  if (args.length > 0) {
    text += ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
  }

  const logLine = `[${timestamp}] [${level}] ${text}\n`;
  
  try {
    fs.appendFileSync(logFile, logLine);
  } catch (err) {
    // Si no se puede escribir en el archivo (ej: permisos), solo ignoramos para no romper la app
    console.error('No se pudo escribir en el archivo de log:', err);
  }
}

export const logger = {
  info: (msg: any, ...args: any[]) => {
    console.log(`[INFO]`, msg, ...args);
    writeToFile('INFO', msg, ...args);
  },
  warn: (msg: any, ...args: any[]) => {
    console.warn(`[WARN]`, msg, ...args);
    writeToFile('WARN', msg, ...args);
  },
  error: (msg: any, ...args: any[]) => {
    console.error(`[ERROR]`, msg, ...args);
    writeToFile('ERROR', msg, ...args);
  },
  debug: (msg: any, ...args: any[]) => {
    console.debug(`[DEBUG]`, msg, ...args);
    writeToFile('DEBUG', msg, ...args);
  },
};
