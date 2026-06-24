const BASE_URL = 'https://bakery-orders-ebon.vercel.app'

async function main() {
  const payload = {
    business_slug: 'cakewalk',
    external_order_id: `TEST-${Date.now()}`,
    customer_name: 'Ali Khan',
    customer_phone: '+923335036779',
    items: [
      {
        name: 'Chocolate Cake',
        quantity: 1,
        price: 2500,
        image_url: 'https://cakewalk.pk/_next/image?url=https%3A%2F%2Fassets.indolj.io%2Fupload%2F1720091382-Chocolate%20Gannache.webp%3Fq%3D10&w=640&q=75',
      },
      {
        name: 'Vanilla Cupcakes',
        quantity: 6,
        price: 1800,
      },
    ],
    total_amount: 4300,
    currency: 'PKR',
    payment_method: 'cod',
    delivery_address: '123 Main St, DHA Phase 5, Lahore',
  }

  console.log(`POST ${BASE_URL}/api/orders`)
  console.log('Payload:', JSON.stringify(payload, null, 2))
  console.log()

  const res = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const body = await res.json()

  console.log(`Status: ${res.status}`)
  console.log('Response:', JSON.stringify(body, null, 2))

  if (!res.ok) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
