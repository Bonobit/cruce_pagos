export const logger = {
  info: (msg: any, ...args: any[]) => console.log(`[INFO]`, msg, ...args),
  warn: (msg: any, ...args: any[]) => console.warn(`[WARN]`, msg, ...args),
  error: (msg: any, ...args: any[]) => console.error(`[ERROR]`, msg, ...args),
  debug: (msg: any, ...args: any[]) => console.debug(`[DEBUG]`, msg, ...args),
};
