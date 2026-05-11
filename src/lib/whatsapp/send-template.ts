const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0'

// ============================================================
// Types
// ============================================================

export type SendResult =
  | { success: true; whatsapp_message_id: string }
  | { success: false; error: string; meta_error_code?: number }

type TemplateVariables = {
  customer_name: string       // {{1}}
  order_id: string            // {{2}}
  items_text: string          // {{3}}
  total_with_currency: string // {{4}}
  payment_method: string      // {{5}}
  delivery_address: string    // {{6}}
}

type SendParams = {
  business: {
    id: string
    whatsapp_phone_number_id: string
    whatsapp_template_name: string
    whatsapp_template_language?: string
  }
  customer_phone: string
  template_variables: TemplateVariables
  header_image_url: string
}

// Shape of a successful WhatsApp Cloud API response
type WhatsAppApiSuccess = {
  messaging_product: string
  contacts: Array<{ input: string; wa_id: string }>
  messages: Array<{ id: string }>
}

// Shape of a WhatsApp Cloud API error response
type WhatsAppApiError = {
  error: {
    message: string
    type: string
    code: number
    error_data?: { messaging_product: string; details: string }
    fbtrace_id: string
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Formats order items into a single-line string for the template body.
 * e.g. "1× Chocolate Cake • 6× Vanilla Cupcakes"
 */
export function formatItemsForMessage(
  items: { name: string; quantity: number }[]
): string {
  return items.map((item) => `${item.quantity}× ${item.name}`).join(' • ')
}

function sanitizeForTemplate(text: string): string {
  return text.replace(/[\n\r\t]+/g, ' ').trim()
}

/**
 * Formats a numeric amount into a human-readable currency string.
 * PKR → "Rs. 4,300" | USD → "$45.00" | EUR → "€45.00" | others → "XYZ 45.00"
 */
export function formatCurrency(amount: number, currency: string): string {
  switch (currency.toUpperCase()) {
    case 'PKR':
      return `Rs. ${Math.round(amount).toLocaleString('en-PK')}`
    case 'USD':
      return `$${amount.toFixed(2)}`
    case 'EUR':
      return `€${amount.toFixed(2)}`
    case 'GBP':
      return `£${amount.toFixed(2)}`
    default:
      return `${currency.toUpperCase()} ${amount.toFixed(2)}`
  }
}

/**
 * Returns the human-readable label for a payment method code.
 */
export function formatPaymentMethod(method: 'cod' | 'paid'): string {
  return method === 'cod' ? 'Cash on Delivery' : 'Paid Online'
}

// ============================================================
// Main send function
// ============================================================

export async function sendOrderConfirmationTemplate(
  params: SendParams
): Promise<SendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN environment variable is not set')
  }

  const { business, customer_phone, template_variables, header_image_url } = params

  // WhatsApp Cloud API requires the phone number without the leading +
  const to = customer_phone.startsWith('+')
    ? customer_phone.slice(1)
    : customer_phone

  const url = `${GRAPH_API_BASE}/${business.whatsapp_phone_number_id}/messages`

  const requestBody = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: business.whatsapp_template_name,
      language: { code: business.whatsapp_template_language ?? 'en' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'image',
              image: { link: header_image_url },
            },
          ],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: sanitizeForTemplate(template_variables.customer_name) },
            { type: 'text', text: sanitizeForTemplate(template_variables.order_id) },
            { type: 'text', text: sanitizeForTemplate(template_variables.items_text) },
            { type: 'text', text: sanitizeForTemplate(template_variables.total_with_currency) },
            { type: 'text', text: sanitizeForTemplate(template_variables.payment_method) },
            { type: 'text', text: sanitizeForTemplate(template_variables.delivery_address) },
          ],
        },
      ],
    },
  }

  // Send the request
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Network error: ${message}` }
  }

  const responseData = (await response.json()) as WhatsAppApiSuccess | WhatsAppApiError

  if (!response.ok) {
    const apiErr = responseData as WhatsAppApiError
    const code = apiErr?.error?.code
    const message = apiErr?.error?.message ?? 'Unknown error from WhatsApp API'
    console.error('[WhatsApp] API error response:', {
      status: response.status,
      code,
      message,
      phone_number_id: business.whatsapp_phone_number_id,
      to,
    })
    return { success: false, error: message, meta_error_code: code }
  }

  const successData = responseData as WhatsAppApiSuccess
  const messageId = successData?.messages?.[0]?.id

  if (!messageId) {
    console.error('[WhatsApp] Unexpected response shape (no message ID):', successData)
    return {
      success: false,
      error: 'WhatsApp API returned success but response contained no message ID',
    }
  }

  return { success: true, whatsapp_message_id: messageId }
}

// ============================================================
// Plain-text message (used for button-tap acknowledgements)
// Only valid within the 24-hour customer service window, which is
// open immediately after the customer taps a button.
// ============================================================

export async function sendSimpleTextMessage(params: {
  business: { whatsapp_phone_number_id: string }
  to: string  // E.164 with leading +
  text: string
}): Promise<SendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN environment variable is not set')
  }

  const { business, to, text } = params
  const toNumber = to.startsWith('+') ? to.slice(1) : to
  const url = `${GRAPH_API_BASE}/${business.whatsapp_phone_number_id}/messages`

  const requestBody = {
    messaging_product: 'whatsapp',
    to: toNumber,
    type: 'text',
    text: { body: text },
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Network error: ${message}` }
  }

  const responseData = (await response.json()) as WhatsAppApiSuccess | WhatsAppApiError

  if (!response.ok) {
    const apiErr = responseData as WhatsAppApiError
    const code = apiErr?.error?.code
    const message = apiErr?.error?.message ?? 'Unknown error from WhatsApp API'
    console.error('[WhatsApp] sendSimpleTextMessage error:', {
      status: response.status,
      code,
      message,
      phone_number_id: business.whatsapp_phone_number_id,
    })
    return { success: false, error: message, meta_error_code: code }
  }

  const successData = responseData as WhatsAppApiSuccess
  const messageId = successData?.messages?.[0]?.id

  if (!messageId) {
    console.error('[WhatsApp] sendSimpleTextMessage: no message ID in response:', successData)
    return {
      success: false,
      error: 'WhatsApp API returned success but response contained no message ID',
    }
  }

  return { success: true, whatsapp_message_id: messageId }
}

// ============================================================
// Cancellation template (2 body variables: customer_name, order_id)
// No header image — assumes order_cancelled_v1 is a text-only template.
// ============================================================

export async function sendCancellationTemplate(params: {
  business: {
    whatsapp_phone_number_id: string
    whatsapp_cancellation_template_name?: string  // defaults to 'order_cancelled_v1'
    whatsapp_template_language?: string
  }
  customer_phone: string
  template_variables: {
    customer_name: string  // {{1}}
    order_id: string       // {{2}}
  }
}): Promise<SendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN
  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN environment variable is not set')
  }

  const { business, customer_phone, template_variables } = params
  const to = customer_phone.startsWith('+') ? customer_phone.slice(1) : customer_phone
  const url = `${GRAPH_API_BASE}/${business.whatsapp_phone_number_id}/messages`
  const templateName = business.whatsapp_cancellation_template_name ?? 'order_cancelled_v1'

  const requestBody = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: business.whatsapp_template_language ?? 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: sanitizeForTemplate(template_variables.customer_name) },
            { type: 'text', text: sanitizeForTemplate(template_variables.order_id) },
          ],
        },
      ],
    },
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Network error: ${message}` }
  }

  const responseData = (await response.json()) as WhatsAppApiSuccess | WhatsAppApiError

  if (!response.ok) {
    const apiErr = responseData as WhatsAppApiError
    const code = apiErr?.error?.code
    const message = apiErr?.error?.message ?? 'Unknown error from WhatsApp API'
    console.error('[WhatsApp] sendCancellationTemplate error:', {
      status: response.status,
      code,
      message,
      phone_number_id: business.whatsapp_phone_number_id,
    })
    return { success: false, error: message, meta_error_code: code }
  }

  const successData = responseData as WhatsAppApiSuccess
  const messageId = successData?.messages?.[0]?.id

  if (!messageId) {
    return {
      success: false,
      error: 'WhatsApp API returned success but response contained no message ID',
    }
  }

  return { success: true, whatsapp_message_id: messageId }
}
