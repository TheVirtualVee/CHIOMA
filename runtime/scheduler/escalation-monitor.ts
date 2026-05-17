export type Escalation = {
  id: string;
  tenant_id: string;
  chat_id: string;
  customer_message: string;
  created_at: Date;
};

export async function getStaleEscalations(sql: any, options: { olderThanMinutes: number }): Promise<Escalation[]> {
  return await sql`
    SELECT * FROM escalation_logs
    WHERE resolved_at IS NULL
      AND emergency_contact_notified = FALSE
      AND created_at < NOW() - INTERVAL '${options.olderThanMinutes} minutes'
    LIMIT 10
  `;
}

export async function escalateToEmergencyContact(sql: any, escalation: Escalation, botToken: string): Promise<void> {
  const [tenant] = await sql`
    SELECT emergency_telegram_id FROM tenants 
    WHERE tenant_id = ${escalation.tenant_id}
  `;
  
  const emergencyTelegramId = tenant?.emergency_telegram_id || process.env.TELEGRAM_ADMIN_CHAT_ID;
  
  if (emergencyTelegramId) {
    try {
      const fetch = globalThis.fetch;
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: emergencyTelegramId,
          text: `🚨 UNRESOLVED ESCALATION\n\nCustomer: ${escalation.chat_id}\nMessage: "${escalation.customer_message}"\nTime: ${escalation.created_at}\n\nPlease respond immediately.`
        })
      });
      
      if (response.ok) {
        await sql`
          UPDATE escalation_logs
          SET emergency_contact_notified = TRUE, notified_at = NOW()
          WHERE id = ${escalation.id}
        `;
      }
    } catch (e) {
      console.error("Failed to send escalation notify", e);
    }
  }
}
