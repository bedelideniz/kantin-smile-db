// Shared auth helper: validates JWT and loads roles from Lovable Cloud.
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

export type AppRole = "super_admin" | "school_admin" | "cashier" | "parent";
export interface UserRole {
  role: AppRole;
  school_id: string | null;
}
export interface AuthContext {
  userId: string;
  email: string | null;
  roles: UserRole[];
}

export async function authenticate(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing Authorization header");
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims) throw new HttpError(401, "Invalid token");

  const { data: rolesData, error: rolesErr } = await supabase.rpc("get_my_roles");
  if (rolesErr) throw new HttpError(500, `Failed to load roles: ${rolesErr.message}`);

  return {
    userId: data.claims.sub as string,
    email: (data.claims.email as string) ?? null,
    roles: (rolesData ?? []) as UserRole[],
  };
}

export function requireRole(ctx: AuthContext, role: AppRole): void {
  if (!ctx.roles.some((r) => r.role === role)) {
    throw new HttpError(403, `Requires role: ${role}`);
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
