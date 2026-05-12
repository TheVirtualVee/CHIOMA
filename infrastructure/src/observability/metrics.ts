/**
 * v1.1 — CSR and trust metrics placeholders (Prometheus / OTEL wiring goes here).
 */
export type CsrSnapshot = {
  commitmentSurvivalRate: number | null;
  trustContinuityIndex: number | null;
};

export function createMetricsSink(): {
  recordCsr: (v: number) => void;
  snapshot: () => CsrSnapshot;
} {
  let csr: number | null = null;
  return {
    recordCsr(v) {
      csr = v;
    },
    snapshot: () => ({ commitmentSurvivalRate: csr, trustContinuityIndex: null }),
  };
}
