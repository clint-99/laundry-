import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { RequestError, text, token, validateBooking } from "./validation.js";
const secret = (key: string) => Deno.env.get(key) || "";
const client = () =>
  createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
async function rpc(
  db: ReturnType<typeof client>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.code === "P0001") throw new RequestError(error.message);
    throw new RequestError(
      "We could not save your request. Please try again.",
      503,
    );
  }
  return data;
}
async function digest(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret("RATE_LIMIT_SALT") + ":" + value),
  );
  return Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
async function rate(
  db: ReturnType<typeof client>,
  key: string,
  limit: number,
  seconds: number,
) {
  if (!secret("RATE_LIMIT_SALT"))
    throw new RequestError(
      "The booking service is being configured. Please message us.",
      503,
    );
  if (
    !(await rpc(db, "consume_rate", {
      p_key: await digest(key),
      p_limit: limit,
      p_seconds: seconds,
    }))
  )
    throw new RequestError(
      "Too many requests. Please try again later or message us.",
      429,
    );
}
async function readBody(req: Request) {
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new RequestError("Send a JSON request.", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new RequestError("Request body required.");
  let size = 0;
  const parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new RequestError("Request too large.", 413);
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(all));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error();
    return data;
  } catch {
    throw new RequestError("Check your request and try again.");
  }
}
export function handler(name: string) {
  return async (req: Request) => {
    const allowed = secret("ALLOWED_ORIGIN");
    const origin = req.headers.get("origin");
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
      "Cache-Control": "no-store",
    };
    const response = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    if (!allowed || origin !== allowed)
      return new Response(
        JSON.stringify({ error: "This origin is not allowed." }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (req.method !== "POST")
      return response({ error: "Use POST for this request." }, 405);
    try {
      const data = await readBody(req),
        db = client();
      // Supabase gateway must supply/overwrite this header. All absent-IP callers share a restrictive bucket.
      const ip = (req.headers.get("x-forwarded-for") || "unknown")
        .split(",")[0]
        .trim();
      if (name === "staff-admin") {
        const jwt = req.headers.get("authorization")?.replace(/^Bearer /i, "");
        if (!jwt) throw new RequestError("Sign in as an owner.", 401);
        const { data: auth, error } = await db.auth.getUser(jwt);
        if (error || !auth.user)
          throw new RequestError("Please sign in again.", 401);
        const { data: profile } = await db
          .from("profiles")
          .select("role,active")
          .eq("id", auth.user.id)
          .single();
        if (!profile?.active || profile.role !== "owner")
          throw new RequestError("Owner access required.", 403);
        await rate(db, "staff:" + auth.user.id, 40, 3600);
        const action = text(data, "action", 1, 30);
        if (action === "create_rider") {
          const email = text(data, "email", 3, 254),
            name = text(data, "full_name", 1, 120),
            password = text(data, "temp_password", 12, 128);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new RequestError("Check the email address.");
          const { data: user, error: createError } =
            await db.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
            });
          if (createError || !user.user)
            throw new RequestError(
              "Could not create this account. Check the email and password policy.",
            );
          const { error: profileError } = await db
            .from("profiles")
            .insert({ id: user.user.id, role: "rider", full_name: name });
          if (profileError) {
            await db.auth.admin.deleteUser(user.user.id);
            throw new RequestError("Could not create the rider profile.", 503);
          }
          return response({ ok: true });
        }
        const id = text(data, "user_id", 36, 36);
        const { data: target } = await db
          .from("profiles")
          .select("role")
          .eq("id", id)
          .single();
        if (target?.role !== "rider")
          throw new RequestError("Choose a rider account.");
        if (action === "set_active") {
          if (typeof data.active !== "boolean")
            throw new RequestError("Choose an access setting.");
          const { error: e } = await db
            .from("profiles")
            .update({ active: data.active })
            .eq("id", id);
          if (e) throw new RequestError("Could not update access.", 503);
          return response({ ok: true });
        }
        if (action === "reset_password") {
          const password = text(data, "temp_password", 12, 128);
          const { error: e } = await db.auth.admin.updateUserById(id, {
            password,
          });
          if (e)
            throw new RequestError(
              "Could not reset the password. Check the password policy.",
            );
          return response({ ok: true });
        }
        throw new RequestError("Unknown staff action.");
      }
      await rate(
        db,
        `${name}:ip:${ip}`,
        name === "public-config" ? 120 : name === "book-new" ? 10 : 30,
        3600,
      );
      if (name === "public-config")
        return response(await rpc(db, "public_config"));
      if (name === "lookup")
        return response(
          await rpc(db, "booking_lookup", { p_token: token(data) }),
        );
      if (name === "book-again") {
        const clean = validateBooking(data, true);
        return response(
          await rpc(db, "create_booking", { p_data: clean, p_returning: true }),
        );
      }
      if (name === "book-new") {
        const captcha = text(data, "turnstile_token", 1, 2048);
        if (!secret("TURNSTILE_SECRET_KEY"))
          throw new RequestError(
            "The booking service is being configured. Please message us.",
            503,
          );
        const verify = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            body: new URLSearchParams({
              secret: secret("TURNSTILE_SECRET_KEY"),
              response: captcha,
            }),
          },
        );
        if (!verify.ok)
          throw new RequestError(
            "Could not verify the security check. Please try again.",
            503,
          );
        const verification = await verify.json();
        if (
          !verification.success ||
          verification.hostname !== new URL(allowed).hostname ||
          verification.action !== "new-booking"
        )
          throw new RequestError("Please complete the security check again.");
        const clean = validateBooking(data, false);
        await rate(db, "phone:" + clean.phone, 3, 86400);
        return response({
          ...(await rpc(db, "create_booking", {
            p_data: clean,
            p_returning: false,
          })),
          message:
            "Request received. We'll confirm shortly by message or text.",
        });
      }
      if (name === "track") {
        const order = text(data, "order_no", 5, 24),
          last = text(data, "phone_last4", 4, 4);
        if (!/^LD-\d+$/.test(order) || !/^\d{4}$/.test(last))
          throw new RequestError("Check your tracking details.");
        const result = await rpc(db, "track_booking", {
          p_order: order,
          p_last4: last,
        });
        if (!result) throw new RequestError("No matching request found.", 404);
        return response(result);
      }
      throw new RequestError("Not found.", 404);
    } catch (error) {
      if (error instanceof RequestError)
        return response({ error: error.message }, error.status);
      return response(
        { error: "Something went wrong. Please try again." },
        503,
      );
    }
  };
}
