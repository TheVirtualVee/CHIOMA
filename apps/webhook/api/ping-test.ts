/**
 * api/ping-test.ts
 */
export default async function handler(req: any, res: any) {
  res.status(200).json({ 
    message: "PONG", 
    timestamp: new Date().toISOString(),
    root_check: "apps/webhook/api" 
  });
}
