export type ChiomaLogger = {
  info: (msg: string, ctx?: Record<string, unknown>) => void;
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
  error: (msg: string, ctx?: Record<string, unknown>) => void;
};

export function createConsoleLogger(scope: string): ChiomaLogger {
  const p = (level: string, msg: string, ctx?: Record<string, unknown>) => {
    const line = ctx ? `${msg} ${JSON.stringify(ctx)}` : msg;
    const prefix = `[${scope}] ${line}`;
    // SIDE EFFECT: console output for local/dev observability. Why necessary and unavoidable: no external log sink in scaffold.
    if (level === "error") console.error(prefix);
    else if (level === "warn") console.warn(prefix);
    else console.log(prefix);
  };
  return {
    info: (m, c) => p("info", m, c),
    warn: (m, c) => p("warn", m, c),
    error: (m, c) => p("error", m, c),
  };
}
