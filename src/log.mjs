// Minimal structured logger: timestamped, colour-free, one line per event.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const levelName = () => (process.env.LOG_LEVEL || 'info').toLowerCase();

export function createLogger(scope) {
  const threshold = LEVELS[levelName()] ?? LEVELS.info;

  const emit = (level, message, extra) => {
    if (LEVELS[level] < threshold) return;
    const stamp = new Date().toISOString().slice(11, 23);
    const line = `${stamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(extra === undefined ? `${line}\n` : `${line} ${JSON.stringify(extra)}\n`);
  };

  return {
    debug: (m, e) => emit('debug', m, e),
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
    child: (suffix) => createLogger(`${scope}:${suffix}`),
  };
}
