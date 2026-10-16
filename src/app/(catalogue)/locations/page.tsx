import { Suspense } from "react";
import { MapPin } from "lucide-react";
import { getLocationItemCounts, getLocations } from "@/lib/actions/locations";
import { NO_LOCATION_ITEMS } from "@/lib/catalogue/location-items";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { LocationActions } from "./actions";
import { LocationCard } from "./location-card";

export const metadata = { title: "Locations" };

async function LocationsContent() {
  const [locations, itemCounts] = await Promise.all([getLocations(), getLocationItemCounts()]);

  if (locations.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title="No locations yet"
        action={<LocationActions />}
      />
    );
  }

  return (
    // A deleted location hands the focus to the next one (FocusKeeper)
    <div className="space-y-4" data-focus-list="locations">
      {locations.map((location) => (
        <div key={location.id} data-focus-row="">
          <LocationCard
            id={location.id}
            name={location.name}
            type={location.type}
            street={location.street}
            city={location.city}
            region={location.region}
            country={location.country}
            countryCode={location.countryCode}
            postalCode={location.postalCode}
            latitude={location.latitude}
            longitude={location.longitude}
            isActive={location.isActive}
            items={itemCounts.get(location.id) ?? NO_LOCATION_ITEMS}
            subLocations={location.subLocations}
          />
        </div>
      ))}
    </div>
  );
}

export default function LocationsPage() {
  return (
    <>
      <PageHeader
        title="Locations"
        actions={<LocationActions />}
      />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <LocationsContent />
      </Suspense>
    </>
  );
}
