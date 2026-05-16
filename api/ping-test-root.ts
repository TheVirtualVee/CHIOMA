/**
 * api/ping-test-root.ts
 */
export default async function handler(_req: any, res: any) {
  res.status(200).json({ 
    message: "PONG_ROOT", 
    timestamp: new Date().toISOString(),
    status: "ALIVE"
  });
}
