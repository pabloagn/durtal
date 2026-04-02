"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { GooglePlacesSearch } from "@/components/venues/google-places-search";
import type { GooglePlaceResult } from "@/components/venues/google-places-search";
import { createVenue } from "@/lib/actions/venues";
import type { VenueType } from "@/lib/actions/venues";

const VENUE_TYPE_OPTIONS: { value: VenueType; label: string }[] = [
  { value: "bookshop", label: "Bookshop" },
  { value: "online_store", label: "Online Store" },
  { value: "cafe", label: "Cafe" },
  { value: "library", label: "Library" },
  { value: "museum", label: "Museum" },
  { value: "gallery", label: "Gallery" },
  { value: "auction_house", label: "Auction House" },
  { value: "market", label: "Market" },
  { value: "fair", label: "Fair" },
  { value: "publisher", label: "Publisher" },
  { value: "individual", label: "Individual" },
  { value: "other", label: "Other" },
];

export function VenueCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState<VenueType>("bookshop");
  const [subtype, setSubtype] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [formattedAddress, setFormattedAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [specialties, setSpecialties] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");

  // Google Places data (stored for submission)
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);
  const [placeCoords, setPlaceCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  function resetForm() {
    setName("");
    setType("bookshop");
    setSubtype("");
    setDescription("");
    setWebsite("");
    setInstagramHandle("");
    setFormattedAddress("");
    setPhone("");
    setEmail("");
    setSpecialties("");
    setNotes("");
    setTagsRaw("");
    setGooglePlaceId(null);
    setPlaceCoords(null);
  }

  function handlePlaceSelect(place: GooglePlaceResult) {
    if (!name.trim()) {
      setName(place.name);
    }
    if (place.formattedAddress) {
      setFormattedAddress(place.formattedAddress);
    }
    if (place.nationalPhoneNumber) {
      setPhone(place.nationalPhoneNumber);
    }
    if (place.websiteUri) {
      setWebsite(place.websiteUri);
    }
    setGooglePlaceId(place.placeId);
    setPlaceCoords(place.location ?? null);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
    resetForm();
  }

  function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    startTransition(async () => {
      try {
        const venue = await createVenue({
          name: name.trim(),
          type,
          subtype: subtype.trim() || null,
          description: description.trim() || null,
          website: website.trim() || null,
          instagramHandle: instagramHandle.trim() || null,
          formattedAddress: formattedAddress.trim() || null,
          googlePlaceId: googlePlaceId ?? null,
          placeCoordinates: placeCoords ?? null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          specialties: specialties.trim() || null,
          notes: notes.trim() || null,
          tags: tags.length > 0 ? tags : null,
        });
        toast.success(`Venue "${venue.name}" created`);
        setOpen(false);
        resetForm();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to create venue",
        );
      }
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add Venue
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        title="Add Venue"
      >
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <div className="space-y-6">
            {/* Identity */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                Identity
              </h3>
              <div className="space-y-3">
                <Input
                  label="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Type"
                    options={VENUE_TYPE_OPTIONS}
                    value={type}
                    onChange={(e) => setType(e.target.value as VenueType)}
                  />
                  <Input
                    label="Subtype"
                    value={subtype}
                    onChange={(e) => setSubtype(e.target.value)}
                    placeholder="e.g. second-hand, academic"
                  />
                </div>
                <Textarea
                  label="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Brief description of the venue"
                />
              </div>
            </section>

            {/* Location */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                Location
              </h3>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-fg-secondary">
                    Search Google Places
                  </label>
                  <GooglePlacesSearch
                    onSelect={handlePlaceSelect}
                    disabled={isPending}
                  />
                  {googlePlaceId && (
                    <p className="text-xs text-accent-sage">
                      Place linked — fields auto-filled below.
                    </p>
                  )}
                </div>
                <Input
                  label="Address"
                  value={formattedAddress}
                  onChange={(e) => setFormattedAddress(e.target.value)}
                  placeholder="Full address"
                />
              </div>
            </section>

            {/* Contact */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                Contact
              </h3>
              <div className="space-y-3">
                <Input
                  label="Website"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <Input
                  label="Instagram"
                  value={instagramHandle}
                  onChange={(e) => setInstagramHandle(e.target.value)}
                  placeholder="@handle"
                />
              </div>
            </section>

            {/* Notes */}
            <section>
              <h3 className="mb-3 font-serif text-lg text-fg-secondary">
                Notes
              </h3>
              <div className="space-y-3">
                <Input
                  label="Specialties"
                  value={specialties}
                  onChange={(e) => setSpecialties(e.target.value)}
                  placeholder="e.g. rare books, first editions, art books"
                />
                <Textarea
                  label="Personal Notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Personal notes about this venue"
                />
                <Input
                  label="Tags"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="Comma-separated tags"
                />
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-glass-border pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                Creating
              </>
            ) : (
              "Create Venue"
            )}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
