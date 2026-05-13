import { Resend } from 'resend'
import { generateTeamActionToken } from '@/lib/security/team-action-token'
import { formatCurrency, formatPaymentMethod } from '@/lib/whatsapp/send-template'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://bakery-orders-ebon.vercel.app'

// ============================================================
// Types
// ============================================================

export type EmailSendResult =
  | { success: true; email_id: string }
  | { success: false; error: string }

type OrderForEmail = {
  id: string
  external_order_id: string
  customer_name: string
  customer_phone: string
  items: { name: string; quantity: number; price: number }[]
  total_amount: number
  currency: string
  payment_method: string
  delivery_address: string | null
  created_at: string
}

// ============================================================
// HTML helpers
// ============================================================

function actionUrl(orderId: string, action: 'confirmed' | 'cancelled' | 'unreachable'): string {
  const token = generateTeamActionToken(orderId, action)
  return `${APP_URL}/api/team-action?order=${orderId}&action=${action}&token=${encodeURIComponent(token)}`
}

function buildEmailHtml(
  businessName: string,
  order: OrderForEmail,
  reminderNumber: 1 | 2
): string {
  const confirmedUrl = actionUrl(order.id, 'confirmed')
  const cancelledUrl = actionUrl(order.id, 'cancelled')
  const unreachableUrl = actionUrl(order.id, 'unreachable')

  const itemRows = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;color:#333;">${item.name}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;color:#333;text-align:center;">${item.quantity}</td>
          <td style="padding:6px 0;border-bottom:1px solid #f0f0f0;color:#333;text-align:right;">${formatCurrency(item.price, order.currency)}</td>
        </tr>`
    )
    .join('')

  const orderedAt = new Date(order.created_at).toLocaleString('en-PK', {
    timeZone: 'Asia/Karachi',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Order Alert — ${order.external_order_id}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table width="600" cellpadding="0" cellspacing="0" role="presentation"
               style="max-width:600px;width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">

          <!-- Header -->
          <tr>
            <td style="background:#18181b;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 8px;font-size:32px;">🎂</p>
              <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;letter-spacing:-.3px;">${businessName}</h1>
              <p style="margin:6px 0 0;color:#a1a1aa;font-size:13px;">
                Reminder ${reminderNumber} of 2 &nbsp;·&nbsp; Order needs attention
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 32px;">

              <!-- Customer info -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                     style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:24px;">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;">Customer</p>
                    <p style="margin:0;font-size:16px;font-weight:600;color:#111;">${order.customer_name}</p>
                    <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">${order.customer_phone}</p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;">Order</p>
                    <p style="margin:0;font-size:16px;font-weight:600;color:#111;">${order.external_order_id}</p>
                    <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">${orderedAt}</p>
                  </td>
                </tr>
              </table>

              <!-- Items -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:4px;">
                <thead>
                  <tr>
                    <th style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;padding-bottom:8px;">Item</th>
                    <th style="text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;padding-bottom:8px;">Qty</th>
                    <th style="text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;padding-bottom:8px;">Price</th>
                  </tr>
                </thead>
                <tbody>${itemRows}</tbody>
              </table>

              <!-- Total + payment -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                     style="border-top:2px solid #18181b;padding-top:12px;margin-bottom:24px;">
                <tr>
                  <td style="font-size:15px;font-weight:700;color:#111;">Total</td>
                  <td style="text-align:right;font-size:15px;font-weight:700;color:#111;">${formatCurrency(order.total_amount, order.currency)}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6b7280;padding-top:4px;">Payment</td>
                  <td style="text-align:right;font-size:13px;color:#6b7280;padding-top:4px;">${formatPaymentMethod(order.payment_method as 'cod' | 'paid')}</td>
                </tr>
                ${order.delivery_address ? `
                <tr>
                  <td style="font-size:13px;color:#6b7280;padding-top:4px;">Delivery</td>
                  <td style="text-align:right;font-size:13px;color:#6b7280;padding-top:4px;">${order.delivery_address}</td>
                </tr>` : ''}
              </table>

              <!-- Action buttons -->
              <p style="margin:0 0 14px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.5px;">Take action</p>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-bottom:10px;">
                    <a href="${confirmedUrl}"
                       style="display:block;background:#16a34a;color:#fff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:8px;font-size:15px;font-weight:600;">
                      ✅ Mark as Confirmed
                    </a>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom:10px;">
                    <a href="${cancelledUrl}"
                       style="display:block;background:#dc2626;color:#fff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:8px;font-size:15px;font-weight:600;">
                      ❌ Mark as Cancelled
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>
                    <a href="${unreachableUrl}"
                       style="display:block;background:#374151;color:#fff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:8px;font-size:15px;font-weight:600;">
                      📞 Customer Unreachable
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                These links expire in 24 hours &nbsp;·&nbsp; ${businessName} Order Management
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ============================================================
// Main function
// ============================================================

export async function sendTeamReminderEmail(params: {
  to: string[]
  business_name: string
  order: OrderForEmail
  reminder_number: 1 | 2
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set')
  }

  if (params.to.length === 0) {
    return { success: false, error: 'No recipient addresses provided' }
  }

  const resend = new Resend(apiKey)

  const subject = `[${params.business_name}] Order ${params.order.external_order_id} needs attention (Reminder ${params.reminder_number})`
  const html = buildEmailHtml(params.business_name, params.order, params.reminder_number)

  try {
    const { data, error } = await resend.emails.send({
      from: `${params.business_name} Orders <onboarding@resend.dev>`,
      to: params.to,
      subject,
      html,
    })

    if (error) {
      console.error('[team-email] Resend error:', error)
      return { success: false, error: error.message }
    }

    return { success: true, email_id: data!.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[team-email] Unexpected error:', message)
    return { success: false, error: message }
  }
}
