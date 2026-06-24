export async function notifyMedusa(
  medusaOrderId: string | null | undefined,
  status: string,
  notes: string
): Promise<void> {
  if (!medusaOrderId) return

  const medusaUrl = process.env.MEDUSA_BACKEND_URL
  const apiKey = process.env.MEDUSA_ADMIN_API_KEY
  if (!medusaUrl || !apiKey) return

  await fetch(`${medusaUrl}/admin/operations/orders/${medusaOrderId}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-medusa-access-token': apiKey,
    },
    body: JSON.stringify({ status, notes }),
  }).catch((err) => console.error('[Medusa sync] failed:', err))
}
