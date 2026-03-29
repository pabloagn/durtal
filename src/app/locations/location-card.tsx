"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AddressInput,
  type AddressFields,
} from "@/components/locations/address-input";
import { updateLocation, deleteLocation } from "@/lib/actions/locations";

interface SubLocation {
  id: string;
  name: string;
}

interface LocationCardProps {
  id: string;
  name: string;
  type: string;
  street: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  instanceCount: number;
  subLocations: SubLocation[];
}

export function LocationCard({
  id,
  name,
  type,
  street,
  city,
  region,
  country,
  countryCode,
  postalCode,
  latitude,
  longitude,
  isActive,
  instanceCount,
  subLocations,
}: LocationCardProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Edit form state
  const [editName, setEditName] = useState(name);
  const [editType, setEditType] = useState(type);
  const [editAddress, setEditAddress] = useState<AddressFields>({
    street: street ?? "",
    city: city ?? "",
    region: region ?? "",
    country: country ?? "",
    countryCode: countryCode ?? "",
    postalCode: postalCode ?? "",
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  });

  const addressLine = [street, city, region, postalCode, country]
    .filter(Boolean)
    .join(", ");

  function handleEdit() {
    if (!editName.trim()) {
      toast.error("Name is required");
      return;
    }
    startTransition(async () => {
      try {
        const isPhysical = editType === "physical";
        await updateLocation(id, {
          name: editName.trim(),
          type: editType,
          street: isPhysical ? editAddress.street || null : null,
          city: isPhysical ? editAddress.city || null : null,
          region: isPhysical ? editAddress.region || null : null,
          country: isPhysical ? editAddress.country || null : null,
          countryCode: isPhysical ? editAddress.countryCode || null : null,
          postalCode: isPhysical ? editAddress.postalCode || null : null,
          latitude: isPhysical ? editAddress.latitude : null,
          longitude: isPhysical ? editAddress.longitude : null,
        });
        toast.success("Location updated");
        setEditOpen(false);
        router.refresh();
      } catch {
        toast.error("Failed to update location");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteLocation(id);
        toast.success("Location deleted");
        setDeleteOpen(false);
        router.refresh();
      } catch {
        toast.error("Failed to delete location");
      }
    });
  }

  return (
    <>
      <Card className="group transition-colors hover:border-fg-muted/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <Link
              href={`/library?location=${id}`}
              className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:text-accent-rose"
            >
              <h3 className="font-serif text-lg text-fg-primary group-hover:text-accent-rose">
                {name}
              </h3>
              <Badge variant={type === "physical" ? "sage" : "blue"}>
                {type}
              </Badge>
              {!isActive && <Badge variant="red">Inactive</Badge>}
            </Link>

            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-fg-muted">
                {instanceCount} {instanceCount === 1 ? "item" : "items"}
              </span>
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-sm p-1 text-fg-muted opacity-0 transition-all hover:bg-bg-tertiary hover:text-fg-secondary group-hover:opacity-100"
                title="Edit location"
              >
                <Pencil className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setDeleteOpen(true)}
                className="rounded-sm p-1 text-fg-muted opacity-0 transition-all hover:bg-accent-red/10 hover:text-accent-red group-hover:opacity-100"
                title="Delete location"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
          {addressLine && (
            <Link
              href={`/library?location=${id}`}
              className="mt-1 block text-xs text-fg-secondary transition-colors hover:text-fg-primary"
            >
              {addressLine}
            </Link>
          )}
        </CardHeader>
        {subLocations.length > 0 && (
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {subLocations.map((sub) => (
                <Badge key={sub.id} variant="default">
                  {sub.name}
                </Badge>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Edit Dialog */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit location"
        description={`Editing "${name}"`}
      >
        <div className="space-y-4">
          <Input
            label="Name"
            id="edit-location-name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
          />
          <Select
            label="Type"
            id="edit-location-type"
            value={editType}
            onChange={(e) => setEditType(e.target.value)}
            options={[
              { value: "physical", label: "Physical" },
              { value: "digital", label: "Digital" },
            ]}
          />
          {editType === "physical" && (
            <div>
              <p className="mb-2 text-xs font-medium text-fg-secondary">
                Address
              </p>
              <AddressInput value={editAddress} onChange={setEditAddress} />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-glass-border pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleEdit}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete location"
        description={`Are you sure you want to delete "${name}"?`}
      >
        <div className="space-y-4">
          {instanceCount > 0 && (
            <div className="rounded-sm border border-accent-red/30 bg-accent-red/5 p-3 text-xs text-fg-secondary">
              This location has {instanceCount}{" "}
              {instanceCount === 1 ? "item" : "items"} assigned to it. Deleting
              it will remove the location reference from those items.
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-glass-border pt-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDelete}
              disabled={isPending}
              className="bg-accent-red/80 hover:bg-accent-red"
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Delete"
              )}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
