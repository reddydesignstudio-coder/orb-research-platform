/**
 * Market-data gateway configuration (TASK 007). Committed, reviewable, non-secret.
 *
 * `plan` is the owner's confirmed provider plan (D-019). `secretName` is the
 * NAME of the Edge Function secret that holds the key — never the key itself.
 */
export const PROVIDER_SETTINGS = Object.freeze({
  twelve_data: Object.freeze({ plan: 'basic', secretName: 'TWELVE_DATA_API_KEY' }),
});
