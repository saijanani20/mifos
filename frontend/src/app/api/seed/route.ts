import { NextResponse } from 'next/server';
import { getAuthenticatedUser, adminSupabase } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// Default admin password strictly from environment (or generated fallback)
const DEFAULT_ADMIN_PASS = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomUUID();

// Canonical branches mapping for seed configuration
const branchData = [
  { name: "Borella",      id: "BRL", email: "branch.brl@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Borella123" },
  { name: "Kotikawatta",  id: "KOT", email: "branch.kot@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Kotikawatta123" },
  { name: "Dematagoda",   id: "DMT", email: "branch.dmt@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Dematagoda123" },
  { name: "Wattala 2",    id: "W2",  email: "branch.w2@rupasinghe.com",  getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Wattala2123" },
  { name: "Wattala 3",    id: "W3",  email: "branch.w3@rupasinghe.com",  getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Wattala3123" },
  { name: "Wattala 4",    id: "W4",  email: "branch.w4@rupasinghe.com",  getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Wattala4123" },
  { name: "Kiribathgoda", id: "KIR", email: "branch.kir@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Kiribathgoda123" },
  { name: "Kadawatha",    id: "KDW", email: "branch.kdw@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Kadawatha123" },
  { name: "Dehiwala",     id: "DHW", email: "branch.dhw@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Dehiwala123" },
  { name: "Panadura",     id: "PND", email: "branch.pnd@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Panadura123" },
  { name: "Kottawa",      id: "KTW", email: "branch.ktw@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Kottawa123" },
  { name: "Homagama",     id: "HMG", email: "branch.hmg@rupasinghe.com", getPassword: () => process.env.INITIAL_BRANCH_PASSWORD || "Homagama123" },
];

export async function GET(request: Request) {
  try {
    const session = await getAuthenticatedUser(request);
    if (!session || session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden. Admin authentication required to run seed scripts.' }, { status: 403 });
    }

    if (!adminSupabase) {
      return NextResponse.json({ error: "Supabase not initialized (Key missing)" }, { status: 500 });
    }
    const results: any[] = [];
    
    // Fetch existing authentication users
    const { data: authUsersResponse, error: listError } = await adminSupabase.auth.admin.listUsers();
    if (listError) throw listError;
    const authUsers = authUsersResponse?.users || [];

    // 1. Ensure System Administrator exists in Auth & Profiles without hardcoding secrets
    const adminAccounts = [
      { email: 'admin@rupasinghe.com', pass: DEFAULT_ADMIN_PASS, name: 'System Administrator' }
    ];

    for (const acc of adminAccounts) {
      const adminEmail = acc.email;
      const adminUser = authUsers.find((u: any) => u.email === adminEmail);
      let adminUserId = adminUser?.id;

      if (!adminUser) {
        const { data: newAdmin, error: createAdminError } = await adminSupabase.auth.admin.createUser({
          email: adminEmail,
          password: acc.pass,
          email_confirm: true,
          user_metadata: { role: 'ADMIN', full_name: acc.name }
        });
        
        if (createAdminError) {
          results.push({ email: adminEmail, status: 'Error Creating Admin', error: createAdminError.message });
        } else {
          adminUserId = newAdmin.user.id;
          results.push({ email: adminEmail, status: 'Admin User Created' });
        }
      } else {
        results.push({ email: adminEmail, status: 'Admin User Exists' });
      }

      // Upsert Admin Profile
      if (adminUserId) {
        const { error: adminProfileError } = await adminSupabase.from('profiles').upsert({
          id: adminUserId,
          email: adminEmail,
          branch_id: 'HQ',
          branch_name: 'Head Office',
          role: 'ADMIN'
        });
        if (adminProfileError) {
          results.push({ email: adminEmail, status: 'Admin Profile Upsert Error', error: adminProfileError.message });
        } else {
          results.push({ email: adminEmail, status: 'Admin Profile Configured' });
        }
      }
    }

    // 2. Process Branches
    for (const branch of branchData) {
      const existingUser = authUsers.find((u: any) => u.email === branch.email);
      let userId = existingUser?.id;

      if (!existingUser) {
        const { data: newUser, error: createError } = await adminSupabase.auth.admin.createUser({
          email: branch.email,
          password: branch.getPassword(),
          email_confirm: true
        });
        
        if (createError) {
          results.push({ email: branch.email, status: 'Error Creating User', error: createError.message });
          continue;
        }
        userId = newUser.user.id;
      }

      // Upsert Profile
      const { error: profileError } = await adminSupabase.from('profiles').upsert({
        id: userId,
        email: branch.email,
        branch_id: branch.id,
        branch_name: branch.name,
        role: 'TELLER'
      });

      // Initial Branch Status
      await adminSupabase.from('branch_status').upsert({
        branch_id: branch.id,
        status: 'CLOSED',
        updated_at: new Date().toISOString()
      }, { onConflict: 'branch_id' });

      results.push({ 
        email: branch.email, 
        status: existingUser ? 'Profile Configured' : 'User/Profile Created',
        profileError: profileError?.message
      });
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
