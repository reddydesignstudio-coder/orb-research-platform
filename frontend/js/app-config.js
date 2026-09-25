/**
 * PUBLIC frontend configuration.
 *
 * Everything in this file is shipped to every visitor's browser.
 * Only two values are allowed here, and both are public by design
 * (ARCHITECTURE.md §9):
 *
 *   supabaseUrl      — https://<project-ref>.supabase.co
 *   supabaseAnonKey  — the Supabase anon / publishable key
 *
 * NEVER put here: provider API keys (Twelve Data etc.), the Supabase
 * service-role / secret key, passwords, or any other credential.
 * Provider keys live only in Supabase Edge Function secrets.
 *
 * `validateConfig` in config.js rejects any other field and any key that
 * is a service-role or secret key, and the app refuses to start with it.
 *
 * Both values stay empty until the Supabase project exists (TASK 003+).
 */
export default Object.freeze({
  supabaseUrl: '',
  supabaseAnonKey: '',
});
