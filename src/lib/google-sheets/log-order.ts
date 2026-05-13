import { getSheetsClient } from './sheets-client'
import { formatItemsForMessage, formatPaymentMethod } from '@/lib/whatsapp/send-template'

// ============================================================
// Constants
// ============================================================

const FRIENDLY_STATUS: Record<string, string> = {
  pending_confirmation: 'Pending Confirmation',
  confirmed: 'Confirmed',
  rejected_by_customer: 'Rejected by Customer',
  cancelled_by_team: 'Cancelled by Team',
  cancelled_no_response: 'Cancelled (No Response)',
  calling_customer: 'Calling Customer',
}

// Column mapping for status-change updates
// A–J written on append; K–N filled when status changes
const TIMESTAMP_COLUMNS: Array<[keyof UpdateFields, string]> = [
  ['confirmed_at', 'K'],
  ['cancelled_at', 'L'],
  ['reminder_1_sent_at', 'M'],
  ['reminder_2_sent_at', 'N'],
]

// ============================================================
// Types
// ============================================================

type AppendOrder = {
  external_order_id: string
  customer_name: string
  customer_phone: string
  items: { name: string; quantity: number; price: number }[]
  total_amount: number
  currency: string
  payment_method: string
  delivery_address: string | null
  status: string
  created_at: string
}

type UpdateFields = {
  status?: string
  confirmed_at?: string
  cancelled_at?: string
  reminder_1_sent_at?: string
  reminder_2_sent_at?: string
}

// ============================================================
// Helpers
// ============================================================

function toKarachi(isoString: string): string {
  return new Date(isoString).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
}

// ============================================================
// appendOrderToSheet
// ============================================================

export async function appendOrderToSheet(params: {
  spreadsheet_id: string
  order: AppendOrder
}): Promise<{ success: boolean; row_number?: number; error?: string }> {
  try {
    const sheets = getSheetsClient()
    const { order } = params

    const row = [
      order.external_order_id,
      order.customer_name,
      order.customer_phone,
      formatItemsForMessage(order.items),
      order.total_amount,
      order.currency,
      formatPaymentMethod(order.payment_method as 'cod' | 'paid'),
      order.delivery_address ?? 'Pickup',
      FRIENDLY_STATUS[order.status] ?? order.status,
      toKarachi(order.created_at),
      '', // K: confirmed_at
      '', // L: cancelled_at
      '', // M: reminder_1_sent_at
      '', // N: reminder_2_sent_at
    ]

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: params.spreadsheet_id,
      range: 'A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    })

    const updatedRange = response.data.updates?.updatedRange ?? ''
    const rowMatch = updatedRange.match(/(\d+)$/)
    const rowNumber = rowMatch ? parseInt(rowMatch[1]) : undefined

    console.log(`[sheets-append] Appended order ${order.external_order_id} at row ${rowNumber ?? '?'}`)
    return { success: true, row_number: rowNumber }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[sheets-append] Failed:', error)
    return { success: false, error }
  }
}

// ============================================================
// updateOrderInSheet
// ============================================================

export async function updateOrderInSheet(params: {
  spreadsheet_id: string
  external_order_id: string
  updates: UpdateFields
}): Promise<{ success: boolean; error?: string }> {
  try {
    const sheets = getSheetsClient()

    // Step 1: Find the row by scanning column A
    const readResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: params.spreadsheet_id,
      range: 'A:A',
    })

    const columnA = readResponse.data.values ?? []
    const rowIndex = columnA.findIndex((row) => row[0] === params.external_order_id)

    if (rowIndex === -1) {
      console.warn(`[sheets-update] Order ${params.external_order_id} not found in sheet`)
      return { success: false, error: 'Row not found' }
    }

    const rowNumber = rowIndex + 1 // Sheets rows are 1-based

    // Step 2: Build batch of cell updates
    const data: Array<{ range: string; values: string[][] }> = []

    if (params.updates.status !== undefined) {
      data.push({
        range: `I${rowNumber}`,
        values: [[FRIENDLY_STATUS[params.updates.status] ?? params.updates.status]],
      })
    }

    for (const [key, col] of TIMESTAMP_COLUMNS) {
      const val = params.updates[key]
      if (val !== undefined) {
        data.push({ range: `${col}${rowNumber}`, values: [[toKarachi(val)]] })
      }
    }

    if (data.length === 0) return { success: true }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: params.spreadsheet_id,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    })

    console.log(`[sheets-update] Updated order ${params.external_order_id} at row ${rowNumber}`)
    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[sheets-update] Failed:', error)
    return { success: false, error }
  }
}
