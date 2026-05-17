// /api/telegram-webhook.ts

export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    source: "bare-function"
  });
}