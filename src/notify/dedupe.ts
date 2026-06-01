export type NotificationDeliveryOutcome = {
  status: 'success' | 'failed';
  httpStatus: number | null;
  error: string | null;
};

export async function claimNotificationDelivery(
  db: D1Database,
  eventKey: string,
  channelId: number,
  createdAt: number,
): Promise<boolean> {
  // 利用 UNIQUE(event_key, channel_id) 约束作为幂等键。
  // 在发送前先插入占位行以锁定该事件。
  const r = await db
    .prepare(
      `
      INSERT OR IGNORE INTO notification_deliveries (
        event_key,
        channel_id,
        status,
        http_status,
        error,
        created_at
      ) VALUES (?1, ?2, 'failed', NULL, 'pending', ?3)
    `,
    )
    .bind(eventKey, channelId, createdAt)
    .run();

  return (r.meta?.changes ?? 0) > 0;
}

export async function finalizeNotificationDelivery(
  db: D1Database,
  eventKey: string,
  channelId: number,
  outcome: NotificationDeliveryOutcome,
): Promise<void> {
  await db
    .prepare(
      `
      UPDATE notification_deliveries
      SET status = ?1, http_status = ?2, error = ?3
      WHERE event_key = ?4 AND channel_id = ?5
    `,
    )
    .bind(outcome.status, outcome.httpStatus, outcome.error, eventKey, channelId)
    .run();
}
