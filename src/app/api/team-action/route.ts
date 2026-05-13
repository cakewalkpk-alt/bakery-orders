import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { verifyTeamActionToken } from '@/lib/security/team-action-token'
import { sendSimpleTextMessage } from '@/lib/whatsapp/send-template'

// Same acknowledgement messages used in the button webhook
const MSG_CONFIRMED =
  "Thank you! Your order has been confirmed. We'll start preparing it shortly. 🎂"
const MSG_CANCELLED =
  'Your order has been cancelled. We hope to serve you again soon. Thank you for considering Cakewalk by Iqra Saadi.'

// ============================================================
// HTML response pages
// ============================================================

function htmlPage(
  emoji: string,
  title: string,
  message: string,
  status = 200
): Response {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | Cakewalk</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      background: #f4f4f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 4px rgba(0,0,0,.1);
      padding: 48px 40px;
      text-align: center;
      max-width: 420px;
      width: 100%;
    }
    .emoji { font-size: 48px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; color: #111; margin-bottom: 12px; }
    p { font-size: 15px; color: #6b7280; line-height: 1.6; }
    .brand { margin-top: 32px; font-size: 12px; color: #d1d5db; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">${emoji}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="brand">🎂 Cakewalk Order Management</p>
  </div>
</body>
</html>`

  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// ============================================================
// GET handler — invoked when a team member clicks an email link
// ============================================================

export async function GET(request: Request) {
  const url = new URL(request.url)
  const orderId = url.searchParams.get('order')
  const action = url.searchParams.get('action')
  const token = url.searchParams.get('token')

  // Basic param check
  if (!orderId || !action || !token) {
    return htmlPage('⚠️', 'Invalid Link', 'This link is missing required parameters.', 400)
  }

  // Verify token
  const verification = verifyTeamActionToken(token)
  if (!verification.valid) {
    console.warn('[team-action] Invalid token:', verification.reason, { orderId, action })
    const isExpired = verification.reason === 'Token expired'
    return htmlPage(
      isExpired ? '⏰' : '🔒',
      isExpired ? 'Link Expired' : 'Invalid Link',
      isExpired
        ? 'This action link has expired. Links are valid for 24 hours after the reminder is sent.'
        : 'This link is invalid or has been tampered with.',
      400
    )
  }

  // Sanity-check that URL params match the token payload
  if (verification.orderId !== orderId || verification.action !== action) {
    console.warn('[team-action] Token/URL param mismatch', { orderId, action, verification })
    return htmlPage('🔒', 'Invalid Link', 'This link is invalid.', 400)
  }

  const supabase = createServiceRoleClient()

  // Look up the order
  const { data: order, error: lookupError } = await supabase
    .from('orders')
    .select('id, business_id, status, customer_phone, external_order_id, team_notes')
    .eq('id', orderId)
    .single()

  if (lookupError || !order) {
    console.error('[team-action] Order not found:', orderId, lookupError)
    return htmlPage('🔍', 'Order Not Found', 'This order could not be found.', 404)
  }

  // Check if already finalized
  const actionableStatuses = ['pending_confirmation', 'calling_customer']
  if (!actionableStatuses.includes(order.status)) {
    return htmlPage(
      'ℹ️',
      'Already Processed',
      `This order has already been processed (status: ${order.status.replace(/_/g, ' ')}).`
    )
  }

  console.log(`[team-action] Processing action='${action}' for order ${orderId}`)

  const now = new Date()

  try {
    if (action === 'confirmed') {
      await supabase
        .from('orders')
        .update({
          status: 'confirmed',
          confirmed_at: now.toISOString(),
          status_updated_by: 'team_action',
        })
        .eq('id', orderId)

      await supabase.from('order_events').insert({
        order_id: orderId,
        business_id: order.business_id,
        event_type: 'team_confirmed',
        event_data: { via: 'email_link' },
      })

      await notifyCustomer(supabase, order, MSG_CONFIRMED)

      return htmlPage(
        '✅',
        'Order Confirmed',
        `Order ${order.external_order_id} has been marked as confirmed. The customer has been notified via WhatsApp.`
      )
    }

    if (action === 'cancelled') {
      await supabase
        .from('orders')
        .update({
          status: 'cancelled_by_team',
          cancelled_at: now.toISOString(),
          status_updated_by: 'team_action',
        })
        .eq('id', orderId)

      await supabase.from('order_events').insert({
        order_id: orderId,
        business_id: order.business_id,
        event_type: 'team_cancelled',
        event_data: { via: 'email_link' },
      })

      await notifyCustomer(supabase, order, MSG_CANCELLED)

      return htmlPage(
        '❌',
        'Order Cancelled',
        `Order ${order.external_order_id} has been cancelled. The customer has been notified via WhatsApp.`
      )
    }

    if (action === 'unreachable') {
      const timestamp = now.toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
      const noteEntry = `Marked unreachable at ${timestamp}`
      const updatedNotes = order.team_notes
        ? `${order.team_notes}\n${noteEntry}`
        : noteEntry

      await supabase
        .from('orders')
        .update({
          team_notes: updatedNotes,
          status_updated_by: 'team_action',
        })
        .eq('id', orderId)

      await supabase.from('order_events').insert({
        order_id: orderId,
        business_id: order.business_id,
        event_type: 'team_marked_unreachable',
        event_data: { via: 'email_link', note: noteEntry },
      })

      return htmlPage(
        '📞',
        'Note Added',
        `Order ${order.external_order_id} has been noted as unreachable. The order remains open — try again or cancel manually.`
      )
    }

    // Unknown action (shouldn't reach here — token validation guards this)
    return htmlPage('⚠️', 'Unknown Action', 'This action is not recognised.', 400)
  } catch (err) {
    console.error('[team-action] Unexpected error:', err)
    return htmlPage(
      '💥',
      'Something Went Wrong',
      'An unexpected error occurred. Please check the order in the dashboard.',
      500
    )
  }
}

// ============================================================
// notifyCustomer — best-effort WhatsApp message to customer
// ============================================================

async function notifyCustomer(
  supabase: ReturnType<typeof createServiceRoleClient>,
  order: { id: string; business_id: string; customer_phone: string },
  message: string
): Promise<void> {
  try {
    const { data: business } = await supabase
      .from('businesses')
      .select('whatsapp_phone_number_id')
      .eq('id', order.business_id)
      .single()

    if (!business?.whatsapp_phone_number_id) {
      console.warn('[team-action] No WhatsApp config for business, skipping customer notify')
      return
    }

    const result = await sendSimpleTextMessage({
      business: { whatsapp_phone_number_id: business.whatsapp_phone_number_id },
      to: order.customer_phone,
      text: message,
    })

    if (!result.success) {
      console.error('[team-action] WhatsApp notify failed:', result.error)
    }
  } catch (err) {
    console.error('[team-action] notifyCustomer unexpected error:', err)
  }
}
