export function computeNextAttemptDelay(attemptCount: number): number | null {
  const delays = [0, 30_000, 300_000, 1_800_000];
  if (attemptCount >= delays.length) return null;
  const base = delays[attemptCount];
  const jitter = Math.random() * base * 0.2;
  return Math.floor(base + jitter);
}
