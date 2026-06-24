import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { sendTeamReminderEmail } from '@/lib/email/send-team-notification'
import { randomUUID } from 'crypto'

async function main() {
  const supabase = createServiceRoleClient()

  // Fetch Cakewalk business config
  const { data: business, error: bizError } = await supabase
    .from('businesses')
    .select('name, team_notify_emails')
    .ilike('name', '%cakewalk%')
    .limit(1)
    .single()

  if (bizError || !business) {
    console.error('Failed to fetch business:', bizError)
    process.exit(1)
  }

  console.log(`Business: ${business.name}`)
  console.log(`Notify emails: ${business.team_notify_emails.join(', ')}`)

  if (business.team_notify_emails.length === 0) {
    console.error('No team_notify_emails set on this business — nothing to send to.')
    process.exit(1)
  }

  const mockOrder = {
    id: '01eed0e4-fcef-4830-a2c9-f462b0f0cb4b',
    external_order_id: `TEST-1778530623719`,
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
    created_at: new Date().toISOString(),
  }

  console.log(`\nSending test email for order ${mockOrder.external_order_id} (id: ${mockOrder.id})`)

  const result = await sendTeamReminderEmail({
    to: business.team_notify_emails,
    business_name: business.name,
    order: mockOrder,
    reminder_number: 1,
  })

  if (result.success) {
    console.log(`\nEmail sent successfully`)
    console.log(`Resend email_id: ${result.email_id}`)
  } else {
    console.error(`\nEmail failed: ${result.error}`)
    process.exit(1)
  }
}

main()
