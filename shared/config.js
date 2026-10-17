// PUBLIC values only. Never put a service-role key or Turnstile secret here.
export const CONFIG = Object.freeze({
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  TURNSTILE_SITE_KEY: "",
  REPOSITORY_URL: "https://github.com/clint-99/laundry-",
  BRAND_NAME: "{{BUSINESS_NAME}}",
  LOGO: new URL("../icons/basket.svg", import.meta.url).href,
});
