import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * Browser Supabase client, or undefined when accounts are not configured.
 * The app keeps working as a guest (local-only) experience in that case.
 */
export function getSupabase(): SupabaseClient | undefined {
  if (client !== undefined) return client ?? undefined;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client = url && key ? createClient(url, key) : null;
  return client ?? undefined;
}
