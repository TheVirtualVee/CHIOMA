import { createHmac, timingSafeEqual } from "node:crypto";

export default async function handler(req: any, res: any) {
  res.status(200).send("ISOLATION_TEST_OK");
}
