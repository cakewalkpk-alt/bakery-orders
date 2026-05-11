import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { sendSimpleTextMessage } from '@/lib/whatsapp/send-template'

// ============================================================
// Response messages sent back to customer after button tap
// ============================================================

const MSG_CONFIRMED =
  "Thank you! Your order has been confirmed. We'll start preparing it shortly. 🎂"
const MSG_CANCELLED =
  'Your order has been cancelled. We hope to serve you again soon. Thank you for considering Cakewalk by Iqra Saadi.'

// ============================================================
// Webhook payload types
// ============================================================

type WhatsAppButtonMessage = {
  from: string
  id: string
  timestamp: string
  type: string
  context?: {
    from: string
    id: string  // ID of the message we originally sent — matches orders.whatsapp_message_id
  }
  button?: {
    payload: string
    text: string
  }
}

type WhatsAppStatusUpdate = {
  id: string
  status: string
  timestamp: string
  recipient_id: string
}

type WhatsAppWebhookValue = {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  contacts?: Array<{
    profile: { name: string }
    wa_id: string
  }>
  messages?: WhatsAppButtonMessage[]
  statuses?: WhatsAppStatusUpdate[]
}

type WhatsAppWebhookChange = {
  field: string
  value: WhatsAppWebhookValue
}

type WhatsAppWebhookEntry = {
  id: string
  changes: WhatsAppWebhookChange[]
}

type WhatsAppWebhookPayload = {
  object: string
  entry: WhatsAppWebhookEntry[]
}

// ============================================================
// GET — Meta verification challenge
// ============================================================

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (!verifyToken) {
    console.error('[WhatsApp webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set')
    return new Response('Forbidden', { status: 403 })
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[WhatsApp webhook] Verification challenge accepted')
    return new Response(challenge ?? '', { status: 200 })
  }

  console.warn('[WhatsApp webhook] Verification failed — token mismatch or wrong mode', { mode })
  return new Response('Forbidden', { status: 403 })
}

// ============================================================
// POST — Incoming events
// ============================================================

export async function POST(request: Request) {
  let payload: WhatsAppWebhookPayload

  try {
    const raw = await request.json()
    payload = raw as WhatsAppWebhookPayload
  } catch {
    // Malformed JSON — acknowledge immediately so Meta doesn't retry
    console.warn('[WhatsApp webhook] Received non-JSON body, ignoring')
    return new Response('OK', { status: 200 })
  }

  // Ignore non-whatsapp_business_account objects
  if (payload.object !== 'whatsapp_business_account') {
    return new Response('OK', { status: 200 })
  }

  const supabase = createServiceRoleClient()

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue

        const value = change.value

        // ── Status updates (delivery / read receipts) ────────────────────────
        if (value.statuses?.length) {
          for (const status of value.statuses) {
            console.log('[WhatsApp webhook] Status update received:', {
              message_id: status.id,
              status: status.status,
              recipient_id: status.recipient_id,
            })
          }
        }

        // ── Inbound messages ─────────────────────────────────────────────────
        for (const message of value.messages ?? []) {
          if (message.type === 'button') {
            await handleButtonTap(supabase, message)
          } else {
            console.log('[WhatsApp webhook] Ignoring non-button message', {
              type: message.type,
              from: message.from,
            })
          }
        }
      }
    }
  } catch (err) {
    // Catch-all: log but still return 200 so Meta doesn't retry
    console.error('[WhatsApp webhook] Unexpected error processing payload:', err)
  }

  return new Response('OK', { status: 200 })
}

// ============================================================
// handleButtonTap — processes a single button tap event
// ============================================================

async function handleButtonTap(
  supabase: ReturnType<typeof createServiceRoleClient>,
  message: WhatsAppButtonMessage
): Promise<void> {
  const contextId = message.context?.id
  const buttonText = message.button?.text ?? ''

  console.log('[WhatsApp webhook] Button tap received:', {
    from: message.from,
    button_text: buttonText,
    context_message_id: contextId,
  })

  if (!contextId) {
    console.warn('[WhatsApp webhook] Button message has no context.id — cannot match order')
    return
  }

  // ── Look up the order and its business in one query ──────────────────────
  const { data: orderRow, error: orderLookupError } = await supabase
    .from('orders')
    .select('id, business_id, status, customer_phone')
    .eq('whatsapp_message_id', contextId)
    .single()

  if (orderLookupError || !orderRow) {
    console.warn('[WhatsApp webhook] No order found for whatsapp_message_id:', contextId)
    return
  }

  console.log('[WhatsApp webhook] Matched order:', {
    order_id: orderRow.id,
    current_status: orderRow.status,
  })

  // ── Only act on orders still awaiting a response ─────────────────────────
  const actionableStatuses = ['pending_confirmation', 'calling_customer']
  if (!actionableStatuses.includes(orderRow.status)) {
    console.log(
      `[WhatsApp webhook] Order ${orderRow.id} already in final status '${orderRow.status}' — ignoring tap`
    )
    return
  }

  // ── Map button text → new status ─────────────────────────────────────────
  const lowerText = buttonText.toLowerCase()
  let newStatus: string
  let replyMessage: string
  let eventType: string
  const now = new Date().toISOString()
  const timestampField: Record<string, string> = {}

  if (lowerText.includes('confirm')) {
    newStatus = 'confirmed'
    timestampField.confirmed_at = now
    replyMessage = MSG_CONFIRMED
    eventType = 'customer_confirmed'
  } else if (lowerText.includes('cancel')) {
    newStatus = 'rejected_by_customer'
    timestampField.cancelled_at = now
    replyMessage = MSG_CANCELLED
    eventType = 'customer_rejected'
  } else {
    console.warn('[WhatsApp webhook] Unrecognised button text:', buttonText)
    return
  }

  // ── Update order status ───────────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: newStatus,
      status_updated_by: 'customer_button',
      ...timestampField,
    })
    .eq('id', orderRow.id)

  if (updateError) {
    console.error('[WhatsApp webhook] Failed to update order status:', updateError)
    return
  }

  console.log(`[WhatsApp webhook] Order ${orderRow.id} updated to '${newStatus}'`)

  // ── Log the event ─────────────────────────────────────────────────────────
  await supabase.from('order_events').insert({
    order_id: orderRow.id,
    business_id: orderRow.business_id,
    event_type: eventType,
    event_data: {
      button_text: buttonText,
      raw_context_id: contextId,
    },
  })

  // ── Fetch business phone_number_id for the reply ──────────────────────────
  const { data: business, error: businessError } = await supabase
    .from('businesses')
    .select('whatsapp_phone_number_id')
    .eq('id', orderRow.business_id)
    .single()

  if (businessError || !business?.whatsapp_phone_number_id) {
    console.error('[WhatsApp webhook] Could not fetch business for reply:', businessError)
    return
  }

  // ── Send acknowledgement back to customer ─────────────────────────────────
  const sendResult = await sendSimpleTextMessage({
    business: { whatsapp_phone_number_id: business.whatsapp_phone_number_id },
    to: `+${message.from}`,  // message.from is already without +
    text: replyMessage,
  })

  if (sendResult.success) {
    console.log('[WhatsApp webhook] Acknowledgement sent:', sendResult.whatsapp_message_id)
  } else {
    console.error('[WhatsApp webhook] Failed to send acknowledgement:', sendResult.error)
  }
}
