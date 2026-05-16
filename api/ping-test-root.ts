/**
 * api/ping-test-root.ts
 */
export default async function handler(req: any, res: any) {
  res.status(200).json({ 
    message: "PONG_ROOT", 
    timestamp: new Date().toISOString(),
    root_check: "repo_root/api" 
  });
}
