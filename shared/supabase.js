import { createClient } from "./vendor/supabase-js-2.118.0.js";
import { CONFIG } from "./config.js";
export const configured = Boolean(
  CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY,
);
export const db = configured
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
export async function query(request) {
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return data;
}
export async function edge(name, body = {}) {
  if (!configured)
    throw new Error(
      "The booking service is not connected yet. Please contact the business.",
    );
  const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The service is unavailable. Please try again.");
  }
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}
export async function staffEdge(body) {
  const session = await query(db.auth.getSession());
  const response = await fetch(
    `${CONFIG.SUPABASE_URL}/functions/v1/staff-admin`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.session?.access_token || ""}`,
      },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Staff update failed");
  return result;
}
