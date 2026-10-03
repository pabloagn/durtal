import { integrationsOverview } from "@/lib/settings/integrations";
import { IntegrationChecks } from "./integration-checks";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  return <IntegrationChecks overview={await integrationsOverview()} />;
}
