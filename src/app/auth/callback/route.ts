import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer, supabaseConfigured } from "@/lib/supabase/server";

// Magic-link and SSO redirects land here with a one-time code.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!supabaseConfigured() || !code) return NextResponse.redirect(`${origin}/sign-in`);
  const sb = await createSupabaseServer();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent("That sign-in link has expired. Request a new one.")}`);
  // Signing in counts as activity for the inactive-account rule.
  const { data } = await sb.auth.getUser();
  if (data.user) await supabaseAdmin().from("profiles").update({ last_active_at: new Date().toISOString(), retention_warned_at: null }).eq("id", data.user.id);
  return NextResponse.redirect(`${origin}/`);
}
