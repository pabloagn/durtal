import { getAppSettings } from "@/lib/actions/settings";
import { getLocations } from "@/lib/actions/locations";
import { GeneralSettings } from "./general-settings";

export const metadata = { title: "Settings" };

export default async function GeneralSettingsPage() {
  const [settings, locations] = await Promise.all([getAppSettings(), getLocations()]);
  return (
    <GeneralSettings
      settings={settings}
      locations={locations.map((location) => ({
        id: location.id,
        name: location.name,
        city: location.city,
        isActive: location.isActive,
      }))}
    />
  );
}
