"use server";

import {
  INTEGRATION_IDS,
  runIntegrationCheck,
  type CheckResult,
  type IntegrationId,
} from "@/lib/settings/integrations";

/** A live check of one outside service: a status and a message, never a secret. */
export async function checkIntegration(id: IntegrationId): Promise<CheckResult> {
  if (!INTEGRATION_IDS.includes(id)) return { status: "error", message: "Unknown service" };
  return runIntegrationCheck(id);
}
