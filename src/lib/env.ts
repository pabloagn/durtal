import { z } from "zod/v4";

/**
 * Environment variables. Every variable the app reads is declared here.
 * Document new variables in `.env.example` and `docs/13_CONFIGURATION.md`.
 *
 * Server values are validated lazily by `serverEnv()` so that `next build`
 * can run without secrets. `src/instrumentation.ts` calls it at server
 * startup, so a missing variable stops the server with a clear message.
 */

/** Empty strings count as unset. */
const optional = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);
const required = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string({ error: "is required" }),
);

const DEFAULT_S3_BUCKET = "durtal";
const DEFAULT_EBOOKS_BUCKET = "durtal-ebooks";

/** The CloudFront variables EBOOK_DELIVERY=cloudfront needs */
const EBOOK_CDN_VARIABLES = ["EBOOK_CDN_URL", "EBOOK_CDN_KEY_PAIR_ID", "EBOOK_CDN_PRIVATE_KEY"] as const;

/** A base64-encoded PEM private key: the value of EBOOK_CDN_PRIVATE_KEY */
function isBase64PrivateKey(value: string) {
  const pem = Buffer.from(value, "base64").toString("utf8");
  return /^-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem.trim());
}

const serverSchema = z.object({
  DATABASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.url({ error: "must be a Postgres connection URL" }),
  ),
  AWS_ACCESS_KEY_ID: required,
  AWS_SECRET_ACCESS_KEY: required,
  AWS_REGION: optional.transform((v) => v ?? "us-east-1"),
  S3_BUCKET: optional.transform((v) => v ?? DEFAULT_S3_BUCKET),
  GOOGLE_BOOKS_API_KEY: optional,
  GOOGLE_PLACES_API_KEY: optional,
  ISBNDB_API_KEY: optional,
  ADMIN_TOKEN: optional,
  DURTAL_API_TOKEN: optional,
  /** The contact in the enrichment User-Agent (SLN-460) */
  ENRICHMENT_CONTACT: optional,
  /** The research agent's main search (Tavily) and its fallback (Brave Search), SLN-469 */
  TAVILY_API_KEY: optional,
  BRAVE_SEARCH_API_KEY: optional,
  /** The research agent's extraction model (Anthropic), SLN-469 */
  ANTHROPIC_API_KEY: optional,
  /** The monthly cap of metered enrichment calls, in US dollars; 0 lets only free-tier calls through */
  ENRICHMENT_MONTHLY_CAP_USD: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().regex(/^\d+(\.\d+)?$/, { error: "must be an amount in US dollars, such as 20 or 7.50" }).optional(),
  ),
  /** The e-book bucket (SLN-491), its key prefix and region */
  EBOOKS_BUCKET: optional.transform((v) => v ?? DEFAULT_EBOOKS_BUCKET),
  EBOOKS_PREFIX: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^([a-z0-9][a-z0-9._-]*\/)+$/, { error: "must be folder names ending in a slash, such as ebooks/" })
      .refine((v) => !v.split("/").includes(".."), { error: "must not contain .." })
      .optional()
      .transform((v) => v ?? ""),
  ),
  EBOOKS_REGION: optional,
  /** cloudfront: signed CloudFront URLs; app: the app streams the bytes itself */
  EBOOK_DELIVERY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["cloudfront", "app"], { error: "must be cloudfront or app" }).default("app"),
  ),
  EBOOK_CDN_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .url({ protocol: /^https$/, error: "must be an https URL, such as https://d111111abcdef8.cloudfront.net" })
      .optional()
      .transform((v) => v?.replace(/\/+$/, "")),
  ),
  EBOOK_CDN_KEY_PAIR_ID: optional,
  EBOOK_CDN_PRIVATE_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().refine(isBase64PrivateKey, { error: "must be a base64-encoded PEM private key" }).optional(),
  ),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
})
  .superRefine((env, ctx) => {
    if (env.EBOOK_DELIVERY !== "cloudfront") return;
    const missing = EBOOK_CDN_VARIABLES.filter((name) => !env[name]);
    if (missing.length)
      ctx.addIssue({
        code: "custom",
        path: ["EBOOK_DELIVERY"],
        message: `cloudfront needs ${missing.join(", ")}`,
      });
  })
  // The e-book bucket is in the app's region unless it says otherwise
  .transform((env) => ({ ...env, EBOOKS_REGION: env.EBOOKS_REGION ?? env.AWS_REGION }));

export type ServerEnv = z.infer<typeof serverSchema>;

let warnedIsbndbRename = false;

/**
 * Validated server environment. Throws one error that lists every problem.
 * Parsed on each call (cheap), so tests can stub variables per case.
 */
export function serverEnv(): ServerEnv {
  let isbndbKey = process.env.ISBNDB_API_KEY;
  if (!isbndbKey && process.env.ISBNDN_API_KEY) {
    // TODO(SLN-309): drop the misspelled name after one release.
    if (!warnedIsbndbRename) {
      console.warn(
        "[env] ISBNDN_API_KEY is deprecated. Rename it to ISBNDB_API_KEY.",
      );
      warnedIsbndbRename = true;
    }
    isbndbKey = process.env.ISBNDN_API_KEY;
  }

  const result = serverSchema.safeParse({
    ...process.env,
    ISBNDB_API_KEY: isbndbKey,
  });
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n` +
        "See .env.example and docs/13_CONFIGURATION.md.",
    );
  }
  return result.data;
}

/** The bucket name has a default, so it is safe to read at module load. */
export const S3_BUCKET = process.env.S3_BUCKET || DEFAULT_S3_BUCKET;

/**
 * Public variables, inlined into the client bundle at build time.
 * Next.js only inlines literal `process.env.NEXT_PUBLIC_*` reads.
 */
export const publicEnv = {
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN || undefined,
};
