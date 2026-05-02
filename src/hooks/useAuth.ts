import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

export type AppRole = "super_admin" | "school_admin" | "cashier" | "parent" | "marketer";
export interface UserRole {
  role: AppRole;
  school_id: string | null;
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<UserRole[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // CRITICAL: subscribe BEFORE getSession to avoid missing events
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s) setRoles(null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase.rpc("get_my_roles").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("Failed to load roles:", error);
        setRoles([]);
      } else {
        setRoles((data ?? []) as UserRole[]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const hasRole = (r: AppRole) => !!roles?.some((x) => x.role === r);
  const signOut = () => supabase.auth.signOut();

  return { session, user, roles, loading, hasRole, signOut };
}
