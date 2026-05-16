/**
 * services/business-learning/adapters/tiktok.ts
 */
import { SocialPost, AdapterConfig } from "../types.js";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export async function fetchTikTokPosts(
  handle: string,
  config: AdapterConfig
): Promise<SocialPost[]> {
  if (!config.accessToken || !handle) {
    console.warn(`[SOCIAL_ADAPTER] TikTok credentials or handle missing for ${handle}. Skipping.`);
    return [];
  }

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const response = await fetch(
        `https://open.tiktokapis.com/v2/business/video/list/`,
        {
          headers: {
            "Authorization": `Bearer ${config.accessToken}`
          }
        }
      );

      if (response.status >= 400 && response.status < 500) {
        console.warn(`[SOCIAL_ADAPTER] TikTok Client Error (${response.status}) for ${handle}.`);
        return [];
      }

      if (!response.ok) {
        throw new Error(`API_STATUS_${response.status}`);
      }

      const data = await response.json() as any;
      return (data.videos || []).map((v: any) => ({
        id: v.video_id,
        source: "tiktok",
        content: v.title || "",
        timestamp: new Date(v.create_time * 1000).toISOString(),
      }));

    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES) {
        console.error(`[SOCIAL_ADAPTER] TikTok fetch failed after ${MAX_RETRIES} retries:`, err);
        return [];
      }
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(`[SOCIAL_ADAPTER] Retry ${attempt}/${MAX_RETRIES} in ${backoff}ms after error: ${err}`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }

  return [];
}
