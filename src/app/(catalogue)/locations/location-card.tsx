"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
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
import type { CreateLocationInput } from "@/lib/validations/locations";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  describeLocationItems,
  locationItemCount,
  type LocationItemCounts,
} from "@/lib/catalogue/location-items";
import { updateLocation, deleteLocation } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";

type LocationType = CreateLocationInput["type"];

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
  /** What the location holds, by kind */
  items: LocationItemCounts;
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
  items,
  subLocations,
}: LocationCardProps) {
  // Film copies, paintings and bottles keep the location (the database refuses
  // the delete); book copies are deleted with it
  const blocking = describeLocationItems(items, ["films", "paintings", "perfumes"]);
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Edit form state
  const [editName, setEditName] = useState(name);
  const [editType, setEditType] = useState<LocationType>(type as LocationType);
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
      } catch (error) {
        toast.error(refusalMessage(error, "Failed to update location"));
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
      } catch (error) {
        toast.error(refusalMessage(error, "Failed to delete location"));
      }
    });
  }

  return (
    <>
      <Card className="group transition-colors hover:border-fg-muted/20">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Link
              href={`/library?location=${id}`}
              className="block min-w-[min(100%,12rem)] flex-1 transition-colors hover:text-accent-primary touch-hit"
            >
              <h3 className="type-item-title [overflow-wrap:anywhere] group-hover:text-accent-primary">
                {name}
              </h3>
              <span className="mt-1 flex flex-wrap gap-2">
                <Badge variant={type === "physical" ? "sage" : "blue"}>{type}</Badge>
                {!isActive && <Badge variant="red">Inactive</Badge>}
              </span>
            </Link>

            {/* The row carries the title's type: the count and the buttons
                sit on the title's cap-height center */}
            <div className="type-item-title flex items-start gap-2">
              <CapAligned height={20}>
                <span className="block font-mono text-xs text-fg-secondary">
                  {locationItemCount(items)}
                </span>
              </CapAligned>
              <CapAligned height={24} coarseHeight={44}>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditOpen(true)}
                    className="block rounded-sm p-1 text-fg-muted opacity-0 transition-all hover:bg-bg-tertiary hover:text-fg-secondary group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:p-3.5 pointer-coarse:opacity-100"
                    aria-label="Edit location"
                    data-tooltip="Edit location"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="block rounded-sm p-1 text-fg-muted opacity-0 transition-all hover:bg-accent-red/10 hover:text-accent-red group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:p-3.5 pointer-coarse:opacity-100"
                    aria-label="Delete location"
                    data-tooltip="Delete location"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                </div>
              </CapAligned>
            </div>
          </div>
          {addressLine && (
            <Link
              href={`/library?location=${id}`}
              className="mt-1 block text-xs text-fg-secondary transition-colors hover:text-fg-primary [overflow-wrap:anywhere]"
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
        draft
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit location"
        description={name}
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
            onChange={(e) => setEditType(e.target.value as LocationType)}
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
            <Button data-dismiss=""
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
              busy={isPending}
            >
              Save
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Delete ${name}`}
        description="This cannot be undone."
        className="max-w-lg"
        expandable={false}
      >
        <div className="space-y-4">
          {blocking ? (
            <div className="rounded-sm border border-accent-red/30 bg-accent-red/5 p-3 text-xs text-fg-secondary">
              {name} holds {blocking}. Move{" "}
              {items.films + items.paintings + items.perfumes === 1 ? "it" : "them"}{" "}
              to another location before deleting it.
            </div>
          ) : (
            items.copies > 0 && (
              <div className="rounded-sm border border-accent-red/30 bg-accent-red/5 p-3 text-xs text-fg-secondary">
                Deleting {name} also deletes the{" "}
                {describeLocationItems(items, ["copies"])} kept there.
              </div>
            )
          )}
          <div className="flex items-center justify-end gap-2 border-t border-glass-border pt-4">
            <Button data-dismiss=""
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
              busy={isPending}
              disabled={!!blocking}
              className="bg-accent-red/80 hover:bg-accent-red"
            >
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
