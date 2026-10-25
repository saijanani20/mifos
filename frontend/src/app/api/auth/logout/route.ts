import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  
  response.cookies.set('sb-access-token', '', {
    path: '/',
    expires: new Date(0),
    httpOnly: true,
    sameSite: 'lax'
  });

  response.cookies.set('auth_token', '', {
    path: '/',
    expires: new Date(0),
    httpOnly: true,
    sameSite: 'lax'
  });

  return response;
}
