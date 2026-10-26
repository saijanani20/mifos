import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeBranchId, CANONICAL_BRANCHES } from '@/lib/branch-mapping';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, branch } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    let loginEmail = String(email).trim();
    if (!loginEmail.includes('@')) {
      if (loginEmail.toLowerCase() === 'admin') {
        loginEmail = 'admin@gmail.com';
      } else {
        loginEmail = `${loginEmail.toLowerCase()}@gmail.com`;
      }
    }

    if (loginEmail.toLowerCase() === 'auditor@gmail.com') {
      return NextResponse.json(
        { error: 'Access Denied: The legacy auditor account has been decommissioned.' },
        { status: 403 }
      );
    }

    // Direct Supabase client for authentication
    const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: authData, error: authError } = await authSupabase.auth.signInWithPassword({
      email: loginEmail,
      password: String(password)
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Invalid credentials' },
        { status: 401 }
      );
    }

    // Admin Supabase client to fetch profile safely
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    // Derive role strictly from database profile or auth metadata, defaulting to least-privilege TELLER
    const role = (profile?.role || authData.user.user_metadata?.role || 'TELLER').toUpperCase();
    
    // Determine effective operating branch:
    // Only verified ADMIN users are permitted to switch operating branch at login;
    // All other staff are strictly locked to their database profile branch.
    const selectedBranch = (role === 'ADMIN' && branch) ? normalizeBranchId(branch) : null;
    let effectiveBranch = normalizeBranchId(profile?.branch_id || 'HQ');
    if (selectedBranch && selectedBranch !== 'HQ') {
      effectiveBranch = selectedBranch;
    }

    const branchObj = CANONICAL_BRANCHES.find(b => b.id === effectiveBranch);
    const effectiveBranchName = branchObj ? branchObj.name : (effectiveBranch === 'HQ' ? 'Head Office' : (profile?.branch_name || effectiveBranch));

    // Keep database profile in sync with selected operating branch for ADMIN
    if (role === 'ADMIN' && profile && effectiveBranch && effectiveBranch !== normalizeBranchId(profile.branch_id)) {
      try {
        await adminSupabase
          .from('profiles')
          .update({
            branch_id: effectiveBranch,
            branch_name: effectiveBranchName
          })
          .eq('id', authData.user.id);
      } catch (profErr) {
        console.warn('Failed to update profile branch on login:', profErr);
      }
    }

    const token = authData.session?.access_token || '';
    const refreshToken = authData.session?.refresh_token || '';

    const response = NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        role: role,
        branchId: effectiveBranch,
        branchName: effectiveBranchName
      },
      profile: profile ? { ...profile, branch_id: effectiveBranch, branch_name: effectiveBranchName } : { role, branch_id: effectiveBranch, branch_name: effectiveBranchName },
      token: token,
      refreshToken: refreshToken
    });

    if (token) {
      const isProduction = process.env.NODE_ENV === 'production';
      response.cookies.set('sb-access-token', token, {
        path: '/',
        maxAge: 28800,
        sameSite: 'lax',
        httpOnly: true,
        secure: isProduction
      });
      response.cookies.set('auth_token', token, {
        path: '/',
        maxAge: 28800,
        sameSite: 'lax',
        httpOnly: true,
        secure: isProduction
      });
      if (refreshToken) {
        response.cookies.set('sb-refresh-token', refreshToken, {
          path: '/',
          maxAge: 7 * 24 * 3600, // 7 days
          sameSite: 'lax',
          httpOnly: true,
          secure: isProduction
        });
        response.cookies.set('refresh_token', refreshToken, {
          path: '/',
          maxAge: 7 * 24 * 3600,
          sameSite: 'lax',
          httpOnly: true,
          secure: isProduction
        });
      }
    }

    return response;
  } catch (err: any) {
    console.error('Server login exception:', err);
    return NextResponse.json(
      { error: err.message || 'Authentication server error' },
      { status: 500 }
    );
  }
}
