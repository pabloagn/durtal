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
import { createVenue, updateVenue } from "@/lib/actions/venues";
import { VENUE_TYPES, VENUE_TYPE_LABELS, type VenueType } from "@/lib/catalogue/venues";

const VENUE_TYPE_OPTIONS = VENUE_TYPES.map(value => ({ value, label: VENUE_TYPE_LABELS[value] }));
const RATING_OPTIONS = [
  { value: "", label: "No rating" },
  ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} of 5` })),
];

/** A venue as the editor starts from it */
export interface EditableVenue {
  id: string;
  name: string;
  type: VenueType;
  subtype: string | null;
  description: string | null;
  website: string | null;
  instagramHandle: string | null;
  formattedAddress: string | null;
  phone: string | null;
  email: string | null;
  specialties: string | null;
  notes: string | null;
  tags: string[] | null;
  isFavorite: boolean;
  personalRating: number | null;
  firstVisitDate: string | null;
  lastVisitDate: string | null;
}

/**
 * Add Venue, or edit one when `venue` is given. With `open` and
 * `onOpenChange` the caller controls it (the A menu, the venue page's menu);
 * otherwise it shows its own "Add Venue" button. Mount an edit dialog per
 * opening, so it starts from the venue as it is now. A Google place is
 * optional: every field can be typed by hand.
 */
export function VenueCreateDialog({
  open: controlledOpen,
  onOpenChange,
  venue,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  venue?: EditableVenue;
} = {}) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) =>
    controlled ? onOpenChange?.(next) : setOwnOpen(next);
  const [isPending, startTransition] = useTransition();

  // Form state
  const [name, setName] = useState(venue?.name ?? "");
  const [type, setType] = useState<VenueType>(venue?.type ?? "bookshop");
  const [subtype, setSubtype] = useState(venue?.subtype ?? "");
  const [description, setDescription] = useState(venue?.description ?? "");
  const [website, setWebsite] = useState(venue?.website ?? "");
  const [instagramHandle, setInstagramHandle] = useState(venue?.instagramHandle ?? "");
  const [formattedAddress, setFormattedAddress] = useState(venue?.formattedAddress ?? "");
  const [phone, setPhone] = useState(venue?.phone ?? "");
  const [email, setEmail] = useState(venue?.email ?? "");
  const [specialties, setSpecialties] = useState(venue?.specialties ?? "");
  const [notes, setNotes] = useState(venue?.notes ?? "");
  const [tagsRaw, setTagsRaw] = useState(venue?.tags?.join(", ") ?? "");
  const [isFavorite, setIsFavorite] = useState(venue?.isFavorite ?? false);
  const [rating, setRating] = useState(venue?.personalRating ? String(venue.personalRating) : "");
  const [firstVisit, setFirstVisit] = useState(venue?.firstVisitDate ?? "");
  const [lastVisit, setLastVisit] = useState(venue?.lastVisitDate ?? "");

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
    setIsFavorite(false);
    setRating("");
    setFirstVisit("");
    setLastVisit("");
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

    if (firstVisit && lastVisit && lastVisit < firstVisit) {
      toast.error("The last visit cannot come before the first");
      return;
    }

    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    startTransition(async () => {
      const fields = {
        name: name.trim(),
        type,
        subtype: subtype.trim() || null,
        description: description.trim() || null,
        website: website.trim() || null,
        instagramHandle: instagramHandle.trim() || null,
        formattedAddress: formattedAddress.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        specialties: specialties.trim() || null,
        notes: notes.trim() || null,
        tags: tags.length > 0 ? tags : null,
        isFavorite,
        personalRating: rating ? Number(rating) : null,
        firstVisitDate: firstVisit || null,
        lastVisitDate: lastVisit || null,
      };
      try {
        if (venue) {
          // A Google place chosen now replaces the venue's point; otherwise it stays
          await updateVenue(venue.id, {
            ...fields,
            ...(googlePlaceId ? { googlePlaceId, placeCoordinates: placeCoords ?? null } : {}),
          });
          toast.success("Venue saved");
        } else {
          const created = await createVenue({
            ...fields,
            googlePlaceId: googlePlaceId ?? null,
            placeCoordinates: placeCoords ?? null,
          });
          toast.success(`Venue "${created.name}" created`);
        }
        setOpen(false);
        resetForm();
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : venue ? "Could not save the venue" : "Failed to create venue",
        );
      }
    });
  }

  return (
    <>
      {!controlled && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setOpen(true)}
          type="button"
          data-tooltip="Add Venue"
          data-tooltip-keys="a then l"
          className="shrink-0 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add Venue
        </Button>
      )}

      <Dialog
        open={open}
        onClose={handleClose}
        title={venue ? "Edit venue" : "Add Venue"}
        description={venue?.name}
      >
        <div className="max-h-[75vh] overflow-y-auto pr-1">
          <div className="space-y-6">
            {/* Identity */}
            <section>
              <h3 className="type-group-title mb-3">
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
                    id="venue-type"
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
              <h3 className="type-group-title mb-3">
                Location
              </h3>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="type-label block">
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
              <h3 className="type-group-title mb-3">
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

            {/* Personal */}
            <section>
              <h3 className="type-group-title mb-3">
                Personal
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Select
                    id="venue-rating"
                    label="Rating"
                    options={RATING_OPTIONS}
                    value={rating}
                    onChange={(e) => setRating(e.target.value)}
                  />
                  <label className="flex items-end gap-2 pb-2 text-sm text-fg-primary">
                    <input
                      type="checkbox"
                      checked={isFavorite}
                      onChange={(e) => setIsFavorite(e.target.checked)}
                    />
                    Favorite
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="First visit"
                    type="date"
                    value={firstVisit}
                    onChange={(e) => setFirstVisit(e.target.value)}
                  />
                  <Input
                    label="Last visit"
                    type="date"
                    value={lastVisit}
                    min={firstVisit || undefined}
                    onChange={(e) => setLastVisit(e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* Notes */}
            <section>
              <h3 className="type-group-title mb-3">
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
                {venue ? "Saving" : "Creating"}
              </>
            ) : venue ? (
              "Save"
            ) : (
              "Create Venue"
            )}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
