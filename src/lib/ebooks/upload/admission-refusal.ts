import { z } from "zod/v4";
import { UploadError } from "./protocol";

/** Only the pre-admission generation guard can issue this known refusal.
 * It binds the original request so unrelated HTTP errors never clear pending.
 * It is evidence of refusal, not an invented durable core receipt.
 */
export const admissionRefusalSchema = z.strictObject({
  status: z.literal(409), code: z.literal("generation_changed"), action: z.literal("admit"),
  operationId: z.uuid(), key: z.uuid(), generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type UploadAdmissionRefusalView = z.output<typeof admissionRefusalSchema>;
export class UploadAdmissionRefusal extends UploadError {
  readonly refusal: UploadAdmissionRefusalView;
  constructor(input: UploadAdmissionRefusalView) {
    super(409, "generation_changed", "The worker recovered before this admission. Refresh and reselect the original file, or cancel the upload.");
    this.refusal = admissionRefusalSchema.parse(input);
  }
}
