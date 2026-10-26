import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function isTokenValid(token?: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (!payload.sub) return false;
    // Expired by more than 24 hours (outside active shift window)
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && (nowSec - payload.exp > 24 * 3600)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow public assets, internal next.js endpoints, and static files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/api/auth/refresh') ||
    pathname === '/favicon.ico' ||
    pathname === '/rupasinghe_logo.png' ||
    pathname === '/icon.png' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico')
  ) {
    return NextResponse.next();
  }

  // 2. Check for authentication token in cookies
  const authToken = request.cookies.get('sb-access-token')?.value || request.cookies.get('auth_token')?.value;
  const hasValidToken = isTokenValid(authToken);

  const isLoginPage = pathname === '/login';

  // If user is trying to access protected route without valid token, redirect to /login
  if (!hasValidToken && !isLoginPage && !pathname.startsWith('/api/')) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If authenticated user with valid token visits /login, redirect to dashboard /
  if (hasValidToken && isLoginPage) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
