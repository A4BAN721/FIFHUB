import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { FootballDataProvider } from "./football-provider";
import { SupabaseFootballProvider } from "./supabase-provider";

export async function createServerFootballProvider(): Promise<FootballDataProvider | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseFootballProvider(
      createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    );
  }

  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return null;

  return new SupabaseFootballProvider(await createClient());
}
