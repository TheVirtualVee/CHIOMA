export type ChiomaLogger = {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
  debug: (msg: string, ctx?: Record<string, unknown>) => void;
};

export function createConsoleLogger(service: string): ChiomaLogger {
  const log = (severity: string, message: string, context?: Record<string, unknown>) => {
    const entry = {
      timestamp: new Date().toISOString(),
      severity: severity.toUpperCase(),
      service,
      message,
      ...context,
    };
    // side-effect: stdout JSON emission
    console.log(JSON.stringify(entry));
  };

  return {
    info: (m, c) => log("info", m, c),
    warn: (m, c) => log("warn", m, c),
    error: (m, c) => log("error", m, c),
    debug: (m, c) => log("debug", m, c),
  };
}
