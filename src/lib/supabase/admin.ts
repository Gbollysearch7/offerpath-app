import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. Server only, used for writes students must not be able to
// make themselves (report scores, the shared judgment cache). Always scope queries by user id.
let admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set. It is required to save scores.");
  return (admin ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}
