import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { verifySessionCookie, ADMIN_COOKIE_NAME } from '@/lib/admin/auth'

export async function GET(request: Request) {
  // Verify admin session
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE_NAME}=([^;]*)`))
  const token = match ? decodeURIComponent(match[1]) : ''
  if (!token || !verifySessionCookie(token)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''

  if (q.length < 2) {
    return Response.json([])
  }

  const supabase = createServiceRoleClient()

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('slug', 'cakewalk')
    .single()

  if (!business) {
    return Response.json([])
  }

  // Fetch recent matching orders, then deduplicate by phone in JS.
  // Ordered by created_at DESC so the first hit per phone is their most recent order.
  const { data } = await supabase
    .from('orders')
    .select('customer_phone, customer_name, delivery_address')
    .eq('business_id', business.id)
    .or(`customer_phone.ilike.%${q}%,customer_name.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(50)

  const seen = new Set<string>()
  const results: { name: string; phone: string; last_address: string | null }[] = []

  for (const row of data ?? []) {
    if (!seen.has(row.customer_phone)) {
      seen.add(row.customer_phone)
      results.push({
        name: row.customer_name,
        phone: row.customer_phone,
        last_address: row.delivery_address,
      })
      if (results.length === 5) break
    }
  }

  return Response.json(results)
}
