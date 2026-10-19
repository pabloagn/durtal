"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { SectionHeading } from "@/components/shared/section-heading";
import {
  RemoveButton,
  SingleChoiceField,
  useOrganizationSearch,
} from "@/components/catalogue/record-fields";
import type { getVenueInstitutions } from "@/lib/actions/venue-pages";
import type { OrganizationRole } from "@/lib/catalogue/organizations";
import { VENUE_TYPE_LABELS, type VenueType } from "@/lib/catalogue/venues";
import { linkVenueInstitution, unlinkVenueInstitution } from "@/lib/actions/catalogue-client";
import { refusalMessage } from "@/lib/actions/refusal";
import { useSaveReason } from "@/components/shared/save-reason";

type Institution = Awaited<ReturnType<typeof getVenueInstitutions>>[number];

const RELATION_LABELS = { operator: "Runs it", owner: "Owns it" } as const;
const RELATION_OPTIONS = [
  { value: "operator", label: "Runs this venue" },
  { value: "owner", label: "Owns this venue" },
];

/**
 * The role a new institution gets, from the kind of venue it runs. Venues
 * no organization role fits (a cinema, a library, a cafe, an auction house)
 * link an existing organization only.
 */
const ROLE_FOR: Partial<Record<VenueType, OrganizationRole>> = {
  museum: "museum",
  gallery: "gallery",
  bookshop: "retailer",
  online_store: "retailer",
  perfumery: "retailer",
  market: "retailer",
  fair: "retailer",
  publisher: "publisher",
};

/**
 * Who runs or owns the venue: each institution with its relation and its
 * other venues (branches), and "Link an institution". A venue can have
 * several; an online shop or a bookshop may have none.
 */
export function VenueInstitutions({
  venueId,
  venueName,
  venueType,
  institutions,
}: {
  venueId: string;
  venueName: string;
  venueType: VenueType;
  institutions: Institution[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);

  async function unlink(institution: Institution) {
    try {
      await unlinkVenueInstitution({ organizationId: institution.id, venueId, role: institution.role });
      toast.success(`${institution.name} removed`);
      router.refresh();
    } catch (err) {
      toast.error(refusalMessage(err, "Could not remove the institution"));
    }
  }

  return (
    <section className="mb-10" aria-labelledby="venue-institutions">
      <SectionHeading
        id="venue-institutions"
        title="Institution"
        count={institutions.length || undefined}
        action={
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} data-focus-empty="venue-institutions">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Link an institution
          </Button>
        }
      />
      {institutions.length === 0 ? (
        <p className="text-sm text-fg-secondary">No institution recorded</p>
      ) : (
        <ul className="space-y-2" data-focus-list="venue-institutions">
          {institutions.map((institution) => (
            <li
              key={`${institution.id}-${institution.role}`}
              data-focus-row=""
              className="flex items-start gap-3 rounded-sm border border-glass-border bg-bg-secondary/40 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="type-item-title">{institution.name}</p>
                <p className="mt-0.5 text-sm text-fg-secondary">{RELATION_LABELS[institution.role]}</p>
                {institution.branches.length > 0 && (
                  <p className="mt-1 text-sm text-fg-secondary">
                    Also:{" "}
                    {institution.branches.map((branch, i) => (
                      <span key={branch.id}>
                        {i > 0 && ", "}
                        {branch.slug ? (
                          <Link
                            href={`/places/${branch.slug}`}
                            className="text-fg-primary transition-colors hover:text-accent-primary"
                          >
                            {branch.name}
                          </Link>
                        ) : (
                          branch.name
                        )}
                        {` (${VENUE_TYPE_LABELS[branch.type]}${branch.archived ? ", archived" : ""})`}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              {/* Carries the name's type: the button sits on its cap-height center */}
              <div className="type-item-title">
                <RemoveButton label={`Remove ${institution.name}`} onClick={() => void unlink(institution)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding &&
        createPortal(
          <LinkInstitutionDialog
            venueId={venueId}
            venueName={venueName}
            role={ROLE_FOR[venueType] ?? null}
            onClose={() => setAdding(false)}
          />,
          document.body,
        )}
    </section>
  );
}

function LinkInstitutionDialog({
  venueId,
  venueName,
  role,
  onClose,
}: {
  venueId: string;
  venueName: string;
  /** The role an organization created here gets; none: choose an existing one */
  role: OrganizationRole | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { search, create } = useOrganizationSearch(role ?? "retailer");
  const [choice, setChoice] = useState<{ id: string; label: string } | null>(null);
  const [relation, setRelation] = useState<"operator" | "owner">("operator");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!choice) return setError("Choose an institution");
    setSaving(true);
    setError(null);
    try {
      await linkVenueInstitution({ organizationId: choice.id, venueId, role: relation });
      toast.success(`${choice.label} linked`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(refusalMessage(err, "Could not link the institution"));
    } finally {
      setSaving(false);
    }
  }

  const saveReason = useSaveReason(!choice && "Choose an organization");
  return (
    <Dialog
      draft
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title="Link an institution"
      description={venueName}
      className="max-w-lg"
      expandable={false}
    >
      <div className="space-y-4">
        <SingleChoiceField
          label="Institution"
          value={choice}
          onChange={setChoice}
          search={search}
          onCreate={role ? create : undefined}
          placeholder="Search organizations..."
        />
        <Select
          id="institution-relation"
          label="Relation"
          options={RELATION_OPTIONS}
          value={relation}
          onChange={(e) => setRelation(e.target.value as "operator" | "owner")}
        />
        {/* Under the dialog's body and always in view, with the reason a save
            failed over the buttons (SLN-1056) */}
        <DialogFooter>
          {error && (
            <p role="alert" className="basis-full text-sm text-accent-red-text">
              {error}
            </p>
          )}
          {saveReason.hint}
          <Button data-dismiss="" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" data-shortcut="save" busy={saving} disabled={!choice} aria-describedby={saveReason.describedBy} onClick={save}>
            Link
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
