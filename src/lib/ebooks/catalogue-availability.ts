import { cookies } from "next/headers";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import { getWorkDigitalAvailability, type WorkDigitalAvailability } from "./work-availability";

/** Request adapter: no device cookie or query is created for an empty shelf. */
export async function catalogueAvailability(workIds: readonly string[]) {
  if (!workIds.length) return new Map<string, WorkDigitalAvailability>();
  const device = (await cookies()).get(DEVICE_COOKIE)?.value;
  return getWorkDigitalAvailability(workIds, { deviceId: isDeviceId(device) ? device : null });
}
