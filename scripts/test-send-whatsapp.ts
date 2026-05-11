import {
  sendOrderConfirmationTemplate,
  formatItemsForMessage,
  formatCurrency,
  formatPaymentMethod,
} from '../src/lib/whatsapp/send-template'

// ─── PUT YOUR NUMBER HERE ────────────────────────────────────────────────────
// E.164 format: +<country code><number>, no spaces
// Example: '+923001234567'
const TEST_PHONE_NUMBER: string = '+923335036779'
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ITEMS = [
  { name: 'Chocolate Cake', quantity: 1, price: 2500 },
  { name: 'Vanilla Cupcakes', quantity: 6, price: 1800 },
]

async function main() {
  if (TEST_PHONE_NUMBER === '+92XXXXXXXXXX') {
    console.error('ERROR: Replace TEST_PHONE_NUMBER with your real number first.')
    process.exit(1)
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? 'order_confirmation_v1'

  if (!phoneNumberId) {
    console.error('ERROR: WHATSAPP_PHONE_NUMBER_ID is not set in .env.local')
    process.exit(1)
  }

  const business = {
    id: 'test-business-id',
    whatsapp_phone_number_id: phoneNumberId,
    whatsapp_template_name: templateName,
    whatsapp_template_language: 'en',
  }

  const itemsText = formatItemsForMessage(TEST_ITEMS)
  const totalWithCurrency = formatCurrency(4300, 'PKR')
  const paymentMethodText = formatPaymentMethod('cod')

  const params = {
    business,
    customer_phone: TEST_PHONE_NUMBER,
    template_variables: {
      customer_name: 'Abdullah',
      order_id: 'TEST-001',
      items_text: itemsText,
      total_with_currency: totalWithCurrency,
      payment_method: paymentMethodText,
      delivery_address: 'House: 3, St # 1, E-11/4',
    },
    header_image_url: 'https://cakewalk.pk/_next/image?url=https%3A%2F%2Fassets.indolj.io%2Fupload%2F1720091382-Chocolate%20Gannache.webp%3Fq%3D10&w=640&q=75',
  }

  console.log('Sending WhatsApp template message...')
  console.log('  To:', TEST_PHONE_NUMBER)
  console.log('  Template:', templateName)
  console.log('  Items text:', JSON.stringify(itemsText))
  console.log('  Total:', totalWithCurrency)
  console.log()

  const result = await sendOrderConfirmationTemplate(params)

  if (result.success) {
    console.log('SUCCESS')
    console.log('  WhatsApp message ID:', result.whatsapp_message_id)
  } else {
    console.error('FAILED')
    console.error('  Error:', result.error)
    if (result.meta_error_code) {
      console.error('  Meta error code:', result.meta_error_code)
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
