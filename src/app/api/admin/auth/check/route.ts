import { verifySessionCookie, ADMIN_COOKIE_NAME } from '@/lib/admin/auth'

export async function GET(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE_NAME}=([^;]*)`))
  const token = match ? decodeURIComponent(match[1]) : ''

  return Response.json({ authenticated: token ? verifySessionCookie(token) : false })
}
