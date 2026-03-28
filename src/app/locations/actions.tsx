"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { AddressInput, EMPTY_ADDRESS, type AddressFields } from "@/components/locations/address-input";
import { createLocation } from "@/lib/actions/locations";

export function LocationActions() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [type, setType] = useState("physical");
  const [address, setAddress] = useState<AddressFields>(EMPTY_ADDRESS);

  function resetForm() {
    setName("");
    setType("physical");
    setAddress(EMPTY_ADDRESS);
  }

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    startTransition(async () => {
      try {
        const isPhysical = type === "physical";
        await createLocation({
          name: name.trim(),
          type,
          street: isPhysical ? address.street || null : null,
          city: isPhysical ? address.city || null : null,
          region: isPhysical ? address.region || null : null,
          country: isPhysical ? address.country || null : null,
          countryCode: isPhysical ? address.countryCode || null : null,
          postalCode: isPhysical ? address.postalCode || null : null,
          latitude: isPhysical ? address.latitude : null,
          longitude: isPhysical ? address.longitude : null,
        });
        toast.success("Location created");
        setOpen(false);
        resetForm();
        router.refresh();
      } catch {
        toast.error("Failed to create location");
      }
    });
  }

  return (
    <>
      <Button variant="primary" size="md" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
        Add location
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New location"
        description="Add a physical or digital location for your books"
      >
        <div className="space-y-4">
          <Input
            label="Name"
            id="location-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mexico City apartment"
            autoFocus
          />
          <Select
            label="Type"
            id="location-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={[
              { value: "physical", label: "Physical" },
              { value: "digital", label: "Digital" },
            ]}
          />
          {type === "physical" && (
            <div>
              <p className="mb-2 text-xs font-medium text-fg-secondary">
                Address
              </p>
              <AddressInput value={address} onChange={setAddress} />
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-glass-border pt-4">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
