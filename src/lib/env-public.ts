/**
 * Public variables, inlined into the client bundle at build time.
 * Next.js only inlines literal `process.env.NEXT_PUBLIC_*` reads. Kept apart
 * from env.ts so the browser never bundles the server schema (SLN-1278).
 */
export const publicEnv = {
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined,
};
