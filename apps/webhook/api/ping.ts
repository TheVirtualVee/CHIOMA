export default async function handler(req: any, res: any) {
  console.log("[PING] RECEIVED");
  return res.status(200).json({ ok: true, timestamp: Date.now() });
}
