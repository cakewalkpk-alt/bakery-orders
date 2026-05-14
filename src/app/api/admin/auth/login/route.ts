import { generateSessionCookie, ADMIN_COOKIE_NAME } from '@/lib/admin/auth'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { password } = body as { password?: unknown }

  if (!password || typeof password !== 'string') {
    return Response.json({ error: 'Password required' }, { status: 400 })
  }

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword) {
    console.error('[admin/login] ADMIN_PASSWORD is not set')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (password !== adminPassword) {
    return Response.json({ error: 'Incorrect password' }, { status: 401 })
  }

  const token = generateSessionCookie()
  const secure = process.env.NODE_ENV === 'production'

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${ADMIN_COOKIE_NAME}=${token}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Path=/; Max-Age=604800`,
    },
  })
}
