import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import type { Profile } from '../lib/events-types';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(s: Session | null) {
      if (!s) {
        setProfile(null);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, role, full_name, email')
        .eq('id', s.user.id)
        .maybeSingle();
      if (!cancelled) setProfile((data as Profile | null) ?? null);
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      await loadProfile(session);
      if (!cancelled) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        loadProfile(session);
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  };

  // Mientras no exista perfil (migración pendiente) nadie es super.
  const isSuper = profile?.role === 'super';

  return { session, profile, isSuper, loading, signOut };
}
