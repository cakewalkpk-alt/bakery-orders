import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  sendOrderConfirmationTemplate,
  sendCancellationTemplate,
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

type BusinessConfig = {
  whatsapp_phone_number_id: string
  whatsapp_template_name: string | null
  reminder_1_after_minutes: number
  reminder_2_after_minutes: number
  business_hours_end: number
  timezone: string
}

type PendingOrder = {
  id: string
  external_order_id: string
  business_id: string
  customer_name: string
  customer_phone: string
  items: OrderItem[]
  total_amount: number
  currency: string
  payment_method: string
  delivery_address: string | null
  created_at: string
  reminder_1_sent_at: string | null
  reminder_2_sent_at: string | null
  whatsapp_message_id: string | null
  businesses: BusinessConfig | null
}

type SupabaseClient = ReturnType<typeof createServiceRoleClient>

// ============================================================
// Timezone helpers
// ============================================================

function getLocalComponents(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)

  return {
    year:  parseInt(parts.find((p) => p.type === 'year')!.value),
    month: parseInt(parts.find((p) => p.type === 'month')!.value),
    day:   parseInt(parts.find((p) => p.type === 'day')!.value),
    hour:  parseInt(parts.find((p) => p.type === 'hour')!.value),
  }
}

/**
 * Returns true if `now` is past the auto-cancel threshold:
 * - End-of-business-day on the same calendar day reminder_2 was sent
 *   (or the following day if reminder_2 was sent after business hours).
 * Note: uses +24h approximation for "next day" — DST edge cases are
 * acceptable for a bakery reminder system.
 */
function isPastAutoCancelThreshold(
  reminder2SentAt: Date,
  now: Date,
  timezone: string,
  businessHoursEnd: number
): boolean {
  const r2 = getLocalComponents(reminder2SentAt, timezone)
  const nowLocal = getLocalComponents(now, timezone)

  // Determine which day's EOB is the deadline
  let eob = { year: r2.year, month: r2.month, day: r2.day }
  if (r2.hour >= businessHoursEnd) {
    // reminder_2 arrived after closing time — deadline shifts to next day
    const nextDay = new Date(reminder2SentAt.getTime() + 24 * 60 * 60 * 1000)
    const nd = getLocalComponents(nextDay, timezone)
    eob = { year: nd.year, month: nd.month, day: nd.day }
  }

  const nowNum = nowLocal.year * 10000 + nowLocal.month * 100 + nowLocal.day
  const eobNum = eob.year * 10000 + eob.month * 100 + eob.day

  if (nowNum > eobNum) return true
  if (nowNum === eobNum && nowLocal.hour >= businessHoursEnd) return true
  return false
}

// ============================================================
// Shared helpers
// ============================================================

function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0]
}

// ============================================================
// GET handler — invoked by Vercel cron every 5 minutes
// ============================================================

export async function GET(request: Request) {
  // Verify this is a legitimate Vercel cron call
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[cron] Unauthorized request to process-reminders')
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const now = new Date()

  console.log(`[cron] process-reminders started at ${now.toISOString()}`)

  // Fetch all pending orders with their business config in one query
  const { data, error: fetchError } = await supabase
    .from('orders')
    .select(`
      id, external_order_id, business_id, customer_name, customer_phone,
      items, total_amount, currency, payment_method, delivery_address,
      created_at, reminder_1_sent_at, reminder_2_sent_at, whatsapp_message_id,
      businesses!inner (
        whatsapp_phone_number_id, whatsapp_template_name,
        reminder_1_after_minutes, reminder_2_after_minutes,
        business_hours_end, timezone
      )
    `)
    .eq('status', 'pending_confirmation')

  if (fetchError) {
    console.error('[cron] Failed to fetch pending orders:', fetchError)
    return Response.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }

  const orders = (data ?? []) as unknown as PendingOrder[]
  console.log(`[cron] Found ${orders.length} pending_confirmation orders`)

  const results = { reminder_1: 0, reminder_2: 0, auto_cancelled: 0, skipped: 0, errors: 0 }

  for (const order of orders) {
    const biz = order.businesses

    if (!biz?.whatsapp_phone_number_id) {
      console.warn(`[cron] Order ${order.id} has no WhatsApp config — skipping`)
      results.skipped++
      continue
    }

    try {
      const createdAt = new Date(order.created_at)
      const reminder1SentAt = order.reminder_1_sent_at ? new Date(order.reminder_1_sent_at) : null
      const reminder2SentAt = order.reminder_2_sent_at ? new Date(order.reminder_2_sent_at) : null
      const minutesSinceCreation = (now.getTime() - createdAt.getTime()) / 60_000

      // Check in priority order: auto-cancel first, then reminder 2, then reminder 1

      if (
        reminder2SentAt !== null &&
        isPastAutoCancelThreshold(reminder2SentAt, now, biz.timezone, biz.business_hours_end)
      ) {
        await processAutoCancel(supabase, order, biz, now)
        results.auto_cancelled++
        continue
      }

      if (
        minutesSinceCreation >= biz.reminder_2_after_minutes &&
        reminder1SentAt !== null &&
        reminder2SentAt === null
      ) {
        await processReminder(supabase, order, biz, 2, now)
        results.reminder_2++
        continue
      }

      if (
        minutesSinceCreation >= biz.reminder_1_after_minutes &&
        reminder1SentAt === null
      ) {
        await processReminder(supabase, order, biz, 1, now)
        results.reminder_1++
        continue
      }

      results.skipped++
    } catch (err) {
      console.error(`[cron] Unexpected error on order ${order.id}:`, err)
      results.errors++
    }
  }

  console.log('[cron] process-reminders complete:', results)
  return Response.json({ success: true, processed_at: now.toISOString(), results })
}

// ============================================================
// processReminder — sends reminder 1 or 2
// ============================================================

async function processReminder(
  supabase: SupabaseClient,
  order: PendingOrder,
  biz: BusinessConfig,
  reminderNumber: 1 | 2,
  now: Date
): Promise<void> {
  const label = `reminder_${reminderNumber}`
  console.log(`[cron] ${label}: order ${order.id} (${order.external_order_id})`)

  if (!biz.whatsapp_template_name) {
    console.warn(`[cron] ${label}: no template name on business — skipping order ${order.id}`)
    return
  }

  const headerImageUrl = order.items[0]?.image_url || DEFAULT_HEADER_IMAGE_URL

  const sendResult = await sendOrderConfirmationTemplate({
    business: {
      id: order.business_id,
      whatsapp_phone_number_id: biz.whatsapp_phone_number_id,
      whatsapp_template_name: biz.whatsapp_template_name,
      whatsapp_template_language: 'en',
    },
    customer_phone: order.customer_phone,
    template_variables: {
      customer_name: extractFirstName(order.customer_name),
      order_id: order.external_order_id,
      items_text: formatItemsForMessage(order.items),
      total_with_currency: formatCurrency(order.total_amount, order.currency),
      payment_method: formatPaymentMethod(order.payment_method as 'cod' | 'paid'),
      delivery_address: order.delivery_address ?? 'Pickup',
    },
    header_image_url: headerImageUrl,
  })

  if (sendResult.success) {
    const timestampField = reminderNumber === 1 ? 'reminder_1_sent_at' : 'reminder_2_sent_at'

    await supabase
      .from('orders')
      .update({
        [timestampField]: now.toISOString(),
        // Update message ID so button taps on this new message are matched correctly
        whatsapp_message_id: sendResult.whatsapp_message_id,
      })
      .eq('id', order.id)

    await supabase.from('order_events').insert({
      order_id: order.id,
      business_id: order.business_id,
      event_type: `${label}_sent`,
      event_data: { whatsapp_message_id: sendResult.whatsapp_message_id },
    })

    console.log(`[cron] ${label} sent — order ${order.id}, message_id: ${sendResult.whatsapp_message_id}`)
  } else {
    console.error(`[cron] ${label} failed — order ${order.id}:`, {
      error: sendResult.error,
      meta_error_code: sendResult.meta_error_code,
    })

    await supabase.from('order_events').insert({
      order_id: order.id,
      business_id: order.business_id,
      event_type: `${label}_failed`,
      event_data: {
        error: sendResult.error,
        meta_error_code: sendResult.meta_error_code ?? null,
      },
    })
  }
}

// ============================================================
// processAutoCancel — cancels order and notifies customer
// ============================================================

async function processAutoCancel(
  supabase: SupabaseClient,
  order: PendingOrder,
  biz: BusinessConfig,
  now: Date
): Promise<void> {
  console.log(`[cron] auto_cancel: order ${order.id} (${order.external_order_id})`)

  // Update DB first — cancellation must persist even if the WhatsApp send fails
  const { error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'cancelled_no_response',
      cancelled_at: now.toISOString(),
      status_updated_by: 'auto_cancel',
    })
    .eq('id', order.id)

  if (updateError) {
    console.error(`[cron] auto_cancel DB update failed for order ${order.id}:`, updateError)
    throw updateError  // re-throw so the caller increments errors count
  }

  await supabase.from('order_events').insert({
    order_id: order.id,
    business_id: order.business_id,
    event_type: 'auto_cancelled',
    event_data: { reason: 'no_response_after_reminder_2' },
  })

  // Send cancellation notification to customer (non-fatal if it fails)
  const sendResult = await sendCancellationTemplate({
    business: { whatsapp_phone_number_id: biz.whatsapp_phone_number_id },
    customer_phone: order.customer_phone,
    template_variables: {
      customer_name: extractFirstName(order.customer_name),
      order_id: order.external_order_id,
    },
  })

  if (sendResult.success) {
    console.log(`[cron] Cancellation template sent for order ${order.id}`)
  } else {
    console.error(`[cron] Cancellation template failed for order ${order.id}:`, sendResult.error)
  }
}
