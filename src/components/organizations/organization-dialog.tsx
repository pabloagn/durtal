"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addOrganization, updateOrganizationProfile } from "@/lib/actions/organization-directory";
import {
  ORGANIZATION_ROLE_LABELS,
  type DirectoryRole,
  type NON_PUBLISHING_ROLES,
} from "@/lib/catalogue/organizations";

type Role = (typeof NON_PUBLISHING_ROLES)[number];

/** The roles outside publishing, by the collection that uses them */
const ROLE_GROUPS: { title: string; roles: Role[] }[] = [
  { title: "Perfumes", roles: ["perfume_house", "brand", "manufacturer"] },
  { title: "Films", roles: ["production_company", "distribution_company"] },
  { title: "Paintings", roles: ["museum", "gallery"] },
  { title: "Selling", roles: ["retailer"] },
];

/** An organization as the editor starts from it */
export interface EditableOrganization {
  id: string;
  name: string;
  /** Its book profile, kept on the publisher page */
  kind: DirectoryRole | null;
  roles: Role[];
  country: string | null;
  website: string | null;
  description: string | null;
  aliases: string[];
}

/**
 * Adds an organization, or edits one: its name, its roles outside
 * publishing, other names, country, website and description. A book profile
 * (publishing group, publisher or imprint) is shown but set on the publisher
 * page, where the houses above and under it are chosen.
 */
export function OrganizationDialog({
  open,
  onClose,
  organization,
}: {
  open: boolean;
  onClose: () => void;
  organization?: EditableOrganization;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={organization ? "Edit organization" : "Add organization"}
      description={organization?.name}
      className="max-w-xl"
      expandable={false}
    >
      {/* Mounted per opening, so each starts from the record as it is now */}
      {open && (
        <OrganizationForm
          organization={organization}
          saving={saving}
          setSaving={setSaving}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function OrganizationForm({
  organization,
  saving,
  setSaving,
  onClose,
}: {
  organization?: EditableOrganization;
  saving: boolean;
  setSaving: (saving: boolean) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>(organization?.roles ?? []);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (!saving) onClose();
  };

  async function submit(form: FormData) {
    const text = (key: string) => String(form.get(key) ?? "").trim() || null;
    const name = text("name");
    if (!name) return setError("Give the organization a name");
    if (!organization?.kind && roles.length === 0)
      return setError("Choose at least one role");
    const aliases = [
      ...new Set(
        String(form.get("aliases") ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ];
    const fields = {
      name,
      roles,
      country: text("country"),
      website: text("website"),
      description: text("description"),
      aliases,
    };
    setSaving(true);
    setError(null);
    try {
      if (organization) {
        await updateOrganizationProfile(organization.id, fields);
        toast.success("Organization saved");
        onClose();
        router.refresh();
      } else {
        const created = await addOrganization(fields);
        toast.success(`${name} added`);
        onClose();
        if (created) router.push(`/organizations/${created.slug}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the organization");
    } finally {
      setSaving(false);
    }
  }

  return (
  <form
    className="space-y-5"
    onSubmit={(e) => {
      e.preventDefault();
      void submit(new FormData(e.currentTarget));
    }}
  >
    <Input
      name="name"
      label="Name"
      defaultValue={organization?.name ?? ""}
      maxLength={200}
      required
      disabled={saving}
    />
    <fieldset className="space-y-3" disabled={saving}>
      <legend className="type-label mb-1.5">Roles</legend>
      {organization?.kind && (
        <p className="text-xs text-fg-secondary">
          {ORGANIZATION_ROLE_LABELS[organization.kind].one} of books: set on its publisher page.
        </p>
      )}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {ROLE_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-1 text-xs text-fg-secondary">{group.title}</p>
            <ul className="space-y-1">
              {group.roles.map((role) => (
                <li key={role}>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-primary">
                    <input
                      type="checkbox"
                      checked={roles.includes(role)}
                      onChange={(e) =>
                        setRoles((old) =>
                          e.target.checked ? [...old, role] : old.filter((r) => r !== role),
                        )
                      }
                    />
                    {ORGANIZATION_ROLE_LABELS[role].one}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {!organization && (
        <p className="text-xs text-fg-secondary">
          To add a publisher or an imprint of books, use Publishers.
        </p>
      )}
    </fieldset>
    <div className="grid gap-4 sm:grid-cols-2">
      <Input
        name="country"
        label="Country"
        defaultValue={organization?.country ?? ""}
        maxLength={200}
        disabled={saving}
      />
      <Input
        name="website"
        label="Website"
        type="url"
        placeholder="https://"
        defaultValue={organization?.website ?? ""}
        disabled={saving}
      />
    </div>
    <Textarea
      name="aliases"
      label="Other names, one per line"
      defaultValue={organization?.aliases.join("\n") ?? ""}
      rows={3}
      disabled={saving}
    />
    <Textarea
      name="description"
      label="Description"
      defaultValue={organization?.description ?? ""}
      maxLength={10000}
      rows={4}
      disabled={saving}
    />
    {error && (
      <p role="alert" className="text-sm text-accent-red-text">
        {error}
      </p>
    )}
    <div className="flex justify-end gap-2 border-t border-glass-border pt-4">
      <Button type="button" size="sm" onClick={close} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" size="sm" data-shortcut="save" disabled={saving}>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
        {organization ? "Save" : "Add"}
      </Button>
    </div>
  </form>
  );
}

/**
 * "Add organization" in the directory's header. Its dialog goes to the end of
 * the page, outside the header row, so nothing in the row holds it.
 */
export function AddOrganizationButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" strokeWidth={1.5} />
        Add organization
      </Button>
      {open &&
        createPortal(<OrganizationDialog open onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
