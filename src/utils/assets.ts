import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger';

export const TEMP_DIR = path.join(os.tmpdir(), 'bonobit-cruce-pagos');

/**
 * Extracts a sea asset to the temporary directory
 * @param key The asset key in sea-config.json
 * @param fileName The target filename in the temp directory
 * @returns The absolute path to the extracted file
 */
export function extractAsset(key: string, fileName: string): string | null {
  const targetPath = path.join(TEMP_DIR, fileName);
  
  try {
    // Check if we are in SEA environment
    // @ts-ignore
    const sea = process.getBuiltinModule ? process.getBuiltinModule('node:sea') : null;
    
    if (!sea || !sea.isSea()) {
      return null;
    }

    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    // Always overwrite if in SEA to ensure we have the correct version
    const asset = sea.getAsset(key);
    if (asset) {
      fs.writeFileSync(targetPath, Buffer.from(asset));
      logger.info({ key, targetPath }, 'Activo extraído correctamente del ejecutable');
      return targetPath;
    }
  } catch (error) {
    logger.error({ key, error }, 'Error extrayendo activo del ejecutable');
  }
  
  return null;
}

/**
 * Initializes all necessary assets
 */
export function initAssets() {
  const isPkg = typeof (process as any).pkg !== 'undefined';
  // @ts-ignore
  const isSea = process.getBuiltinModule && process.getBuiltinModule('node:sea').isSea();

  if (isSea) {
    const workerPath = extractAsset('pdf.worker.mjs', 'pdf.worker.mjs');
    
    // Extract public files
    const publicDir = path.join(TEMP_DIR, 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    extractAsset('public/index.html', 'public/index.html');
    extractAsset('public/styles.css', 'public/styles.css');
    extractAsset('public/app.js', 'public/app.js');
    
    return { workerPath };
  }
  
  return { workerPath: null };
}
