import { ActionRefusal } from "@/lib/actions/action-refusal";

/** One multipart request publishes a draft file with the edition's fields. */
export async function saveEditionFileForm(
  values: unknown,
  file: File,
  id?: string,
): Promise<{ id: string; coverUnavailable?: boolean }> {
  const body = new FormData();
  body.set("values", JSON.stringify(values));
  body.set("file", file);
  if (id) body.set("id", id);
  const response = await fetch("/api/editions/form", { method: "POST", body });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    if (response.status < 500 && typeof error?.error === "string")
      throw new ActionRefusal(error.error, error.href);
    throw new Error("The edition could not be saved.");
  }
  return response.json();
}
