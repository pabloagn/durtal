import { imageFileRefusal } from "@/lib/validations/media-security";
import { ExpectedActionError } from "@/lib/actions/expected-error";
import { stageEditionCoverFile } from "./edition-cover";

/** A file stays a draft until the edition's single publishing transaction. */
export async function prepareEditionFile(id: string, file: File) {
  if (!(file instanceof File))
    throw new ExpectedActionError("Choose a cover image.");
  const refusal = imageFileRefusal(file);
  if (refusal) throw new ExpectedActionError(refusal);
  return stageEditionCoverFile(id, Buffer.from(await file.arrayBuffer()));
}
