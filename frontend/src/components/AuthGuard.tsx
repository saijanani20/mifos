'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const refreshToken = localStorage.getItem('refresh_token');
    const storedUser = localStorage.getItem('user');

    const isAuth = Boolean(token && storedUser);

    if (isAuth && token && refreshToken) {
      supabase.auth.getSession().then(({ data }) => {
        if (!data?.session) {
          supabase.auth.setSession({ access_token: token, refresh_token: refreshToken }).catch(() => {});
        }
      }).catch(() => {});
    }

    setTimeout(() => {
      setIsAuthenticated(prev => (prev !== isAuth ? isAuth : prev));
    }, 0);

    const resolveRole = (): 'ADMIN' | 'MANAGER' | 'AUDITOR' | 'TELLER' => {
      const candidates = [
        localStorage.getItem('user_role'),
      ];
      if (storedUser) {
        try {
          const u = JSON.parse(storedUser);
          candidates.push(u.role, u.user_metadata?.role, u.app_metadata?.role);
        } catch {}
      }
      for (const c of candidates) {
        if (!c || typeof c !== 'string') continue;
        const upper = c.toUpperCase().trim();
        if (upper === 'ADMIN') return 'ADMIN';
        if (upper === 'MANAGER') return 'MANAGER';
        if (upper === 'AUDITOR') return 'AUDITOR';
        if (upper === 'TELLER') return 'TELLER';
      }
      return 'TELLER';
    };

    const effectiveRole = resolveRole();

    if (isAuth && pathname === '/login') {
      if (effectiveRole === 'TELLER') {
        window.location.replace('/loans');
      } else if (effectiveRole === 'AUDITOR') {
        window.location.replace('/dashboard/auditor');
      } else if (effectiveRole === 'MANAGER') {
        window.location.replace('/operations/approvals');
      } else {
        window.location.replace('/');
      }
    } else if (!isAuth && pathname !== '/login') {
      window.location.replace('/login');
    } else if (isAuth && effectiveRole === 'TELLER') {
      // Route protection: strictly prevent tellers from navigating to Admin options
      const tellerForbidden = [
        '/',
        '/dashboard',
        '/cctv',
        '/transactions',
        '/employees',
        '/reports',
        '/operations/sms-settings',
        '/operations/audit-logs',
        '/operations/approvals',
        '/accounting/reports'
      ];
      const isForbidden = tellerForbidden.some(prefix => 
        prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(prefix + '/')
      );
      if (isForbidden) {
        window.location.replace('/loans');
      }
    }
  }, [pathname, router]);

  // Inactivity auto-logout monitor (45 minutes) - Excludes ADMIN
  useEffect(() => {
    if (!isAuthenticated || pathname === '/login') return;

    // Check if the current user is an Admin
    const storedUser = localStorage.getItem('user');
    let isUserAdmin = false;
    if (storedUser) {
      try {
        const u = JSON.parse(storedUser);
        const role = (localStorage.getItem('user_role') || u.role || '').toUpperCase().trim();
        isUserAdmin = role === 'ADMIN';
      } catch (e) {}
    }

    // Admins do not have session timeouts
    if (isUserAdmin) return;

    const INACTIVITY_TIMEOUT = 45 * 60 * 1000; // 45 minutes in ms (accommodates busy physical branch operations)

    // Initialize last activity time if not set
    if (!localStorage.getItem('last_activity')) {
      localStorage.setItem('last_activity', Date.now().toString());
    }

    const resetActivity = () => {
      localStorage.setItem('last_activity', Date.now().toString());
    };

    // Attach event listeners for activity tracking (including mobile app switching & touch)
    const events = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart', 'click', 'focus', 'visibilitychange'];
    events.forEach(event => {
      window.addEventListener(event, resetActivity);
    });

    // Check interval to verify inactivity
    const interval = setInterval(() => {
      // Never trigger logout while user is actively inside an open dialog / modal (e.g. KYC photo capture or transaction modal)
      const hasActiveModal = Boolean(
        document.querySelector('[role="dialog"]') || 
        document.querySelector('video') ||
        document.querySelector('[data-state="open"]')
      );
      if (hasActiveModal) {
        resetActivity();
        return;
      }

      const lastActivity = parseInt(localStorage.getItem('last_activity') || '0', 10);
      if (lastActivity && Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        // Session expired! Clear local session data & cookies
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        localStorage.removeItem('last_activity');
        document.cookie = 'sb-access-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        setIsAuthenticated(false);
        router.push('/login?expired=true');
      }
    }, 10000); // Check every 10 seconds

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, resetActivity);
      });
      clearInterval(interval);
    };
  }, [isAuthenticated, pathname, router]);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-primary rounded-2xl animate-spin shadow-xl shadow-primary/20" />
          <p className="text-xl font-black text-primary animate-pulse tracking-tighter uppercase">Initializing Session...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && pathname !== '/login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-amber-500 rounded-2xl animate-spin shadow-xl shadow-amber-500/20" />
          <p className="text-sm font-bold text-slate-300 animate-pulse tracking-wider">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
