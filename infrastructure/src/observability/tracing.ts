/**
 * v1.1 — OpenTelemetry / trace context hooks (no-op until exporter configured).
 */
export type TraceSpan = {
  name: string;
  end: () => void;
};

export function startSpan(name: string): TraceSpan {
  return {
    name,
    end() {
      /* no-op scaffold */
    },
  };
}
