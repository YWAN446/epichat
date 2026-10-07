import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** The signed-in user's client, bound to the request cookies. Server components and route handlers only. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server components cannot write cookies. proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
