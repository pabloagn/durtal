"use server";
import { revalidatePath } from "next/cache";
import { setPreferredFile } from "@/lib/ebooks/preferred-file";
import type { PreferredEbookFileInput } from "@/lib/validations/ebooks";
export async function setPreferredEbookFile(input: PreferredEbookFileInput) {
  const ebook = await setPreferredFile(input);
  revalidatePath("/ebooks");
  revalidatePath(`/ebooks/${ebook.id}`);
  revalidatePath(`/reader/${ebook.id}`);
  return ebook;
}
