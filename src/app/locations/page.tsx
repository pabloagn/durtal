import { Suspense } from "react";
import { MapPin } from "lucide-react";
import { getLocations } from "@/lib/actions/locations";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { LocationActions } from "./actions";
import { LocationCard } from "./location-card";

async function LocationsContent() {
  const locations = await getLocations();

  if (locations.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title="No locations yet"
        description="Create locations to track where your books are stored"
        action={<LocationActions />}
      />
    );
  }

  return (
    <div className="space-y-4">
      {locations.map((location) => (
        <LocationCard
          key={location.id}
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
          instanceCount={location.instances?.length ?? 0}
          subLocations={location.subLocations}
        />
      ))}
    </div>
  );
}

export default function LocationsPage() {
  return (
    <>
      <PageHeader
        title="Locations"
        description="Manage where your books are stored"
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
