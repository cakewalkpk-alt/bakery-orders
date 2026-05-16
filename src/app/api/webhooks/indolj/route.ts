// Adapter: indolj.io POS → /api/orders
// Always returns 200 so indolj does not retry on our internal failures.

const INTERNAL_BASE =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://bakery-orders-ebon.vercel.app'

// ============================================================
// indolj.io payload shape
// ============================================================

type IndoljItem = {
  name: string
  qty: number
  price: string
  discountedPrice: string
}

type IndoljPayload = {
  orderId: string
  payment: string
  customer: {
    firstName: string
    lastName: string
    phoneNumber: string
    address: string
  }
  items: IndoljItem[]
  total: {
    grandTotal: number
    currencyCode: string
  }
}

// ============================================================
// Transform helpers
// ============================================================

function toE164(phone: string): string {
  const trimmed = phone.trim()
  if (trimmed.startsWith('03')) {
    return '+92' + trimmed.slice(1)
  }
  // Already has a + or is another format — return as-is
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`
}

function transformPayload(raw: IndoljPayload) {
  return {
    business_slug: 'cakewalk',
    external_order_id: raw.orderId,
    customer_name: `${raw.customer.firstName} ${raw.customer.lastName}`.trim(),
    customer_phone: toE164(raw.customer.phoneNumber),
    items: raw.items.map((item) => ({
      name: item.name,
      quantity: item.qty,
      price: parseFloat(item.discountedPrice || item.price),
    })),
    total_amount: raw.total.grandTotal,
    currency: 'PKR',
    payment_method: raw.payment === 'paid' ? 'paid' : 'cod',
    delivery_address: raw.customer.address || null,
  }
}

// ============================================================
// Route handler
// ============================================================

export async function POST(request: Request) {
  // Optional: verify webhook signature if configured
  const webhookSecret = process.env.INDOLJ_WEBHOOK_SECRET
  if (webhookSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${webhookSecret}`) {
      console.warn('[indolj-webhook] Unauthorized request')
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let raw: IndoljPayload

  try {
    raw = await request.json()
  } catch {
    console.error('[indolj-webhook] Failed to parse request body')
    // Still return 200 — malformed body is not retriable
    return Response.json({ received: true }, { status: 200 })
  }

  console.log('[indolj-webhook] Received payload:', JSON.stringify(raw))

  const order = transformPayload(raw)

  try {
    const res = await fetch(`${INTERNAL_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(
        `[indolj-webhook] /api/orders responded ${res.status}: ${text}`,
        { external_order_id: raw.orderId }
      )
    } else {
      const json = await res.json()
      console.log('[indolj-webhook] Order created:', json)
    }
  } catch (err) {
    console.error('[indolj-webhook] Failed to call /api/orders:', err, {
      external_order_id: raw.orderId,
    })
  }

  // Always acknowledge indolj so they do not retry
  return Response.json({ received: true }, { status: 200 })
}
