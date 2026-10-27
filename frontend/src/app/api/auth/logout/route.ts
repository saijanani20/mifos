import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  
  const cookiesToClear = ['sb-access-token', 'auth_token', 'sb-refresh-token', 'refresh_token'];
  cookiesToClear.forEach(name => {
    response.cookies.set(name, '', {
      path: '/',
      expires: new Date(0),
      maxAge: 0,
      httpOnly: false,
      sameSite: 'lax'
    });
  });

  return response;
}
