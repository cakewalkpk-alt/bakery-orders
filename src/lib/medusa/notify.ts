export async function notifyMedusa(
  medusaOrderId: string | null | undefined,
  status: string,
  notes: string
): Promise<void> {
  if (!medusaOrderId) return

  const medusaUrl = process.env.MEDUSA_BACKEND_URL
  const webhookSecret = process.env.BAKERY_ORDERS_WEBHOOK_SECRET
  if (!medusaUrl || !webhookSecret) return

  await fetch(`${medusaUrl}/webhooks/bakery-orders/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': webhookSecret,
    },
    body: JSON.stringify({ order_id: medusaOrderId, status, notes }),
  }).catch((err) => console.error('[Medusa sync] failed:', err))
}
