import { z } from "zod/v4";
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const uploadRegistrationTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new") }),
  z.strictObject({ kind: z.literal("add_format"), ebookId: z.uuid(), beforeFingerprint: fingerprint }),
  z.strictObject({ kind: z.literal("replace"), ebookId: z.uuid(), fileId: z.uuid(), beforeFingerprint: fingerprint }),
]);
export type UploadRegistrationTarget = z.output<typeof uploadRegistrationTargetSchema>;
