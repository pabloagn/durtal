import { cookies } from "next/headers";
import { READING_HOME_KEY } from "@/lib/preferences";

/** The home remembered by "I'm at" (the durtal-reading-home cookie), as stored: check it against the homes before use */
export async function storedHomeId(): Promise<string | null> {
  try {
    const raw = (await cookies()).get(READING_HOME_KEY)?.value;
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
