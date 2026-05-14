import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySessionCookie, ADMIN_COOKIE_NAME } from '@/lib/admin/auth'

export function middleware(request: NextRequest) {
  // /admin/new-order is the entry point that shows the password gate itself —
  // always allow through so the login form can render.
  if (request.nextUrl.pathname === '/admin/new-order') {
    return NextResponse.next()
  }

  // All other /admin/* routes require a valid, unexpired session cookie.
  const cookie = request.cookies.get(ADMIN_COOKIE_NAME)
  if (!cookie?.value || !verifySessionCookie(cookie.value)) {
    return NextResponse.redirect(new URL('/admin/new-order', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
