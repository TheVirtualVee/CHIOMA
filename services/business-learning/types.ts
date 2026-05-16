/**
 * services/business-learning/types.ts
 */

export interface SocialPost {
  id: string;
  source: "instagram" | "tiktok";
  content: string;
  timestamp: string;
  media_url?: string;
  permalink?: string;
}

export interface AdapterConfig {
  accessToken?: string;
  businessId?: string;
}
