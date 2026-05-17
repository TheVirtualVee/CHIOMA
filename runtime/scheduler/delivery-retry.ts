export type Delivery = {
  id: string;
  chat_id: string;
  bot_token?: string;
  message: string;
  retry_count: number;
};

export async function getPendingDeliveries(sql: any, options: { olderThanMinutes: number }): Promise<Delivery[]> {
  return await sql`
    SELECT * FROM delivery_queue
    WHERE status = 'PENDING'
      AND created_at < NOW() - INTERVAL '${options.olderThanMinutes} minutes'
      AND retry_count < 5
    ORDER BY created_at ASC
    LIMIT 100
  `;
}

export async function retryDelivery(sql: any, delivery: Delivery): Promise<void> {
  try {
    if (!delivery.bot_token) throw new Error("Missing bot token");
    
    // Fallback global fetch
    const fetch = globalThis.fetch;
    const response = await fetch(`https://api.telegram.org/bot${delivery.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: delivery.chat_id,
        text: delivery.message
      })
    });
    
    if (response.ok) {
      await sql`
        UPDATE delivery_queue
        SET status = 'DELIVERED', delivered_at = NOW()
        WHERE id = ${delivery.id}
      `;
    } else {
      const errTxt = await response.text();
      await sql`
        UPDATE delivery_queue
        SET retry_count = retry_count + 1, last_error = ${errTxt}
        WHERE id = ${delivery.id}
      `;
    }
  } catch (err) {
    await sql`
      UPDATE delivery_queue
      SET retry_count = retry_count + 1, last_error = ${String(err)}
      WHERE id = ${delivery.id}
    `;
  }
}
