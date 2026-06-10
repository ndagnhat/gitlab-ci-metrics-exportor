const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Minimal dependency-free structured (JSON line) logger.
 */
export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function log(lvl, msg, meta) {
    if (LEVELS[lvl] > threshold) return;
    const entry = {
      time: new Date().toISOString(),
      level: lvl,
      msg,
      ...(meta && typeof meta === 'object' ? meta : {}),
    };
    const line = JSON.stringify(entry);
    if (lvl === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }

  return {
    error: (msg, meta) => log('error', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    debug: (msg, meta) => log('debug', msg, meta),
  };
}
