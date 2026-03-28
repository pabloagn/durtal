export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { MapPin } from "lucide-react";
import { getLocations } from "@/lib/actions/locations";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { LocationActions } from "./actions";

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
      {locations.map((location) => {
        const instanceCount = location.instances?.length ?? 0;
        return (
          <Card key={location.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-serif text-lg text-fg-primary">
                    {location.name}
                  </h3>
                  <Badge
                    variant={
                      location.type === "physical" ? "sage" : "blue"
                    }
                  >
                    {location.type}
                  </Badge>
                  {!location.isActive && <Badge variant="red">Inactive</Badge>}
                </div>
                <span className="font-mono text-xs text-fg-muted">
                  {instanceCount} {instanceCount === 1 ? "item" : "items"}
                </span>
              </div>
              {(location.street || location.city || location.country) && (
                <p className="mt-1 text-xs text-fg-secondary">
                  {[
                    location.street,
                    location.city,
                    location.region,
                    location.postalCode,
                    location.country,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
            </CardHeader>
            {location.subLocations.length > 0 && (
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {location.subLocations.map((sub) => (
                    <Badge key={sub.id} variant="default">
                      {sub.name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
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
