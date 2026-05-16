/**
 * services/business-learning/adapters/instagram.ts
 */
import { SocialPost, AdapterConfig } from "../types.js";

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export async function fetchInstagramPosts(
  handle: string,
  config: AdapterConfig
): Promise<SocialPost[]> {
  if (!config.accessToken || !config.businessId || !handle) {
    console.warn(`[SOCIAL_ADAPTER] Instagram credentials or handle missing for ${handle}. Skipping.`);
    return [];
  }

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${config.businessId}/media?fields=id,caption,timestamp,permalink&access_token=${config.accessToken}`
      );

      // Contract: 4xx errors are logged and returned as [] (Terminal)
      if (response.status >= 400 && response.status < 500) {
        console.warn(`[SOCIAL_ADAPTER] Instagram Client Error (${response.status}) for ${handle}.`);
        return [];
      }

      // Contract: 5xx errors or network failures trigger retry
      if (!response.ok) {
        throw new Error(`API_STATUS_${response.status}`);
      }

      const data = await response.json() as any;
      return (data.data || []).map((post: any) => ({
        id: post.id,
        source: "instagram",
        content: post.caption || "",
        timestamp: post.timestamp,
        permalink: post.permalink,
      }));

    } catch (err) {
      attempt++;
      if (attempt > MAX_RETRIES) {
        console.error(`[SOCIAL_ADAPTER] Instagram fetch failed after ${MAX_RETRIES} retries:`, err);
        return [];
      }
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(`[SOCIAL_ADAPTER] Retry ${attempt}/${MAX_RETRIES} in ${backoff}ms after error: ${err}`);
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }

  return [];
}
