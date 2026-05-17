export type RuntimeEvent = {
  id: string;
  tenantId: string;
  source: 'telegram' | 'whatsapp' | 'cron' | 'system';
  channelChatId: string;
  channelUserId: string;
  message?: string;
  metadata?: Record<string, any>;
  timestamp: number;
};
