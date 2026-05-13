import { appendOrderToSheet } from '@/lib/google-sheets/log-order'

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID
  if (!spreadsheetId) {
    console.error('GOOGLE_SHEETS_ID is not set in .env.local')
    process.exit(1)
  }

  const mockOrder = {
    external_order_id: `TEST-SHEETS-${Date.now()}`,
    customer_name: 'Test Customer',
    customer_phone: '+923009137567',
    items: [
      { name: 'Chocolate Cake', quantity: 1, price: 3500 },
      { name: 'Vanilla Cupcakes', quantity: 6, price: 1200 },
    ],
    total_amount: 4700,
    currency: 'PKR',
    payment_method: 'cod',
    delivery_address: '123 Test Street, Islamabad',
    status: 'pending_confirmation',
    created_at: new Date().toISOString(),
  }

  console.log(`Appending test order: ${mockOrder.external_order_id}`)

  const result = await appendOrderToSheet({
    spreadsheet_id: spreadsheetId,
    order: mockOrder,
  })

  if (result.success) {
    console.log(`Success! Appended at row ${result.row_number}`)
  } else {
    console.error(`Failed: ${result.error}`)
    process.exit(1)
  }
}

main()
