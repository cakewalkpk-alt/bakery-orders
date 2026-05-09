import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  sendOrderConfirmationTemplate,
  formatItemsForMessage,
  formatCurrency,
  formatPaymentMethod,
} from '@/lib/whatsapp/send-template'

const DEFAULT_HEADER_IMAGE_URL =
  'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800'

// ============================================================
// Types
// ============================================================

type OrderItem = {
  name: string
  quantity: number
  price: number
  image_url?: string
}

type CreateOrderBody = {
  business_slug: string
  external_order_id: string
  customer_name: string
  customer_phone: string
  items: OrderItem[]
  total_amount: number
  currency: string
  payment_method: string
  delivery_address?: string
}

type ValidationResult =
  | { valid: true; data: CreateOrderBody }
  | { valid: false; error: string }

// ============================================================
// Helpers
// ============================================================

function validate(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object' }
  }

  const b = body as Record<string, unknown>

  const requiredStrings: (keyof CreateOrderBody)[] = [
    'business_slug',
    'external_order_id',
    'customer_name',
    'customer_phone',
    'currency',
    'payment_method',
  ]

  for (const field of requiredStrings) {
    if (!b[field] || typeof b[field] !== 'string') {
      return { valid: false, error: `Missing or invalid field: ${field}` }
    }
  }

  if (!['cod', 'paid'].includes(b.payment_method as string)) {
    return { valid: false, error: 'payment_method must be "cod" or "paid"' }
  }

  const phone = b.customer_phone as string
  if (!/^\+\d+$/.test(phone)) {
    return {
      valid: false,
      error: 'customer_phone must be E.164 format: a + followed by digits only (e.g. +923001234567)',
    }
  }

  if (!Array.isArray(b.items) || b.items.length === 0) {
    return { valid: false, error: 'items must be a non-empty array' }
  }

  for (let i = 0; i < b.items.length; i++) {
    const item = b.items[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: `items[${i}] must be an object` }
    }
    const it = item as Record<string, unknown>
    if (!it.name || typeof it.name !== 'string') {
      return { valid: false, error: `items[${i}].name is required and must be a string` }
    }
    if (typeof it.quantity !== 'number' || it.quantity <= 0 || !Number.isInteger(it.quantity)) {
      return { valid: false, error: `items[${i}].quantity must be a positive integer` }
    }
    if (typeof it.price !== 'number' || it.price < 0) {
      return { valid: false, error: `items[${i}].price must be a non-negative number` }
    }
  }

  if (typeof b.total_amount !== 'number' || b.total_amount <= 0) {
    return { valid: false, error: 'total_amount must be a positive number' }
  }

  return { valid: true, data: b as unknown as CreateOrderBody }
}

// Returns the first word of a full name for a friendlier greeting.
// "Ali Khan" → "Ali"
function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0]
}

// ============================================================
// Route handler
// ============================================================

export async function POST(request: Request) {
  // 1. Parse body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 2. Validate
  const result = validate(body)
  if (!result.valid) {
    return Response.json({ error: result.error }, { status: 400 })
  }

  const data = result.data
  const supabase = createServiceRoleClient()

  try {
    // 3. Look up business by slug — fetch WhatsApp config in same query
    console.log(`[POST /api/orders] Looking up business: ${data.business_slug}`)
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, whatsapp_phone_number_id, whatsapp_template_name')
      .eq('slug', data.business_slug)
      .single()

    if (businessError || !business) {
      return Response.json(
        { error: `No business found with slug: ${data.business_slug}` },
        { status: 404 }
      )
    }

    // 4. Insert order
    console.log(`[POST /api/orders] Inserting order: ${data.external_order_id}`)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        business_id: business.id,
        external_order_id: data.external_order_id,
        customer_name: data.customer_name,
        customer_phone: data.customer_phone,
        items: data.items,
        total_amount: data.total_amount,
        currency: data.currency,
        payment_method: data.payment_method,
        delivery_address: data.delivery_address ?? null,
        status: 'pending_confirmation',
      })
      .select('id')
      .single()

    if (orderError) {
      console.error('[POST /api/orders] Insert order failed:', orderError)
      return Response.json({ error: 'Failed to create order' }, { status: 500 })
    }

    console.log(`[POST /api/orders] Order created: ${order.id}`)

    // 5. Log order_received event
    const { error: eventError } = await supabase.from('order_events').insert({
      order_id: order.id,
      business_id: business.id,
      event_type: 'order_received',
      event_data: { source: 'api', external_order_id: data.external_order_id },
    })

    if (eventError) {
      console.error('[POST /api/orders] Insert order_received event failed:', eventError)
    }

    // 6. Send WhatsApp confirmation
    // Wrapped in its own try/catch — a failure here must never lose the order.
    try {
      if (!business.whatsapp_phone_number_id || !business.whatsapp_template_name) {
        console.warn(
          `[POST /api/orders] Business ${data.business_slug} has no WhatsApp config — skipping send`
        )
      } else {
        console.log(`[POST /api/orders] Sending WhatsApp message to ${data.customer_phone}`)

        const headerImageUrl = data.items[0]?.image_url || DEFAULT_HEADER_IMAGE_URL

        const sendResult = await sendOrderConfirmationTemplate({
          business: {
            id: business.id,
            whatsapp_phone_number_id: business.whatsapp_phone_number_id,
            whatsapp_template_name: business.whatsapp_template_name,
            whatsapp_template_language: 'en',
          },
          customer_phone: data.customer_phone,
          template_variables: {
            customer_name: extractFirstName(data.customer_name),
            order_id: data.external_order_id,
            items_text: formatItemsForMessage(data.items),
            total_with_currency: formatCurrency(data.total_amount, data.currency),
            payment_method: formatPaymentMethod(data.payment_method as 'cod' | 'paid'),
            delivery_address: data.delivery_address ?? 'Pickup',
          },
          header_image_url: headerImageUrl,
        })

        if (sendResult.success) {
          console.log(
            `[POST /api/orders] WhatsApp sent — message_id: ${sendResult.whatsapp_message_id}`
          )

          // Update order with the WhatsApp message ID (used later for button webhooks)
          const { error: updateError } = await supabase
            .from('orders')
            .update({ whatsapp_message_id: sendResult.whatsapp_message_id })
            .eq('id', order.id)

          if (updateError) {
            console.error('[POST /api/orders] Failed to save whatsapp_message_id:', updateError)
          }

          await supabase.from('order_events').insert({
            order_id: order.id,
            business_id: business.id,
            event_type: 'whatsapp_sent',
            event_data: { whatsapp_message_id: sendResult.whatsapp_message_id },
          })
        } else {
          console.error('[POST /api/orders] WhatsApp send failed:', {
            order_id: order.id,
            error: sendResult.error,
            meta_error_code: sendResult.meta_error_code,
          })

          await supabase.from('order_events').insert({
            order_id: order.id,
            business_id: business.id,
            event_type: 'whatsapp_send_failed',
            event_data: {
              error: sendResult.error,
              meta_error_code: sendResult.meta_error_code ?? null,
            },
          })
        }
      }
    } catch (whatsappErr) {
      // Non-fatal: order is saved regardless of WhatsApp outcome
      console.error('[POST /api/orders] Unexpected error during WhatsApp send:', whatsappErr)
    }

    // 7. Return success — always, as long as the order was saved
    return Response.json({
      success: true,
      order_id: order.id,
      external_order_id: data.external_order_id,
    })
  } catch (err) {
    console.error('[POST /api/orders] Unexpected error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
