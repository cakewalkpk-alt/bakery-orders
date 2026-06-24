import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { appendOrderToSheet } from '@/lib/google-sheets/log-order'
import { getSheetsClient } from '@/lib/google-sheets/sheets-client'

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID
  if (!spreadsheetId) {
    console.error('GOOGLE_SHEETS_ID not set')
    process.exit(1)
  }

  console.log('Fetching orders from Supabase...')
  const supabase = createServiceRoleClient()

  // Get Cakewalk business
  const { data: business } = await supabase
    .from('businesses')
    .select('id, google_sheet_id')
    .eq('slug', 'cakewalk')
    .single()

  if (!business) {
    console.error('Cakewalk business not found')
    process.exit(1)
  }

  // Get all orders
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })

  if (!orders || orders.length === 0) {
    console.log('No orders found')
    return
  }

  console.log(`Found ${orders.length} orders in Supabase`)

  // Get all order IDs from Sheet
  console.log('Fetching order IDs from Google Sheet...')
  const sheets = getSheetsClient()
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A:A',
  })

  const sheetOrderIds = new Set(
    (response.data.values || []).slice(1).map((row) => row[0]) // skip header
  )

  console.log(`Found ${sheetOrderIds.size} orders in Sheet`)

  // Find missing orders
  const missing = orders.filter((o) => !sheetOrderIds.has(o.external_order_id))

  if (missing.length === 0) {
    console.log('✅ No missing orders - Sheet is up to date')
    return
  }

  console.log(`\n📝 Syncing ${missing.length} missing orders...`)

  let synced = 0
  for (const order of missing) {
    try {
      const result = await appendOrderToSheet({
        spreadsheet_id: spreadsheetId,
        order: {
          external_order_id: order.external_order_id,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          items: order.items as any,
          total_amount: order.total_amount,
          currency: order.currency,
          payment_method: order.payment_method,
          delivery_address: order.delivery_address,
          status: order.status,
          created_at: order.created_at,
        },
      })

      if (result.success) {
        console.log(`  ✅ ${order.external_order_id} → row ${result.row_number}`)
        synced++
      } else {
        console.error(`  ❌ ${order.external_order_id}: ${result.error}`)
      }
    } catch (err) {
      console.error(`  ❌ ${order.external_order_id}: ${err}`)
    }
  }

  console.log(`\n✅ Synced ${synced}/${missing.length} orders`)
}

main()