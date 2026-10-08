// ── Types ───────────────────────────────────────────────────────────────────

export type OwnershipStatus =
  | "unowned"
  | "physical_only"
  | "digital_only"
  | "physical_and_digital";

export type CatalogueStatusValue =
  | "tracked"
  | "shortlisted"
  | "wanted"
  | "on_order"
  | "accessioned"
  | "deaccessioned";

export type InstanceStatusValue =
  | "available"
  | "lent_out"
  | "in_transit"
  | "in_storage"
  | "missing"
  | "damaged"
  | "deaccessioned";

export interface InstanceWithLocation {
  id: string;
  status: InstanceStatusValue;
  format: string | null;
  fileSizeBytes: number | null;
  lentTo: string | null;
  lentDate: string | null;
  location: {
    id: string;
    name: string;
    type: "physical" | "digital";
    color: string | null;
    icon: string | null;
  };
  subLocation?: {
    name: string;
  } | null;
}

export interface OwnershipSummary {
  ownershipStatus: OwnershipStatus;
  physicalCount: number;
  digitalCount: number;
  totalActive: number;
  totalDeaccessioned: number;
}

export interface DerivedStatus {
  label: string;
  description: string;
  isPartiallyHeld: boolean;
  isInconsistent: boolean;
}

// ── Ownership computation ───────────────────────────────────────────────────

export function computeOwnershipSummary(
  instances: InstanceWithLocation[],
): OwnershipSummary {
  let physicalCount = 0;
  let digitalCount = 0;
  let totalDeaccessioned = 0;

  for (const inst of instances) {
    if (inst.status === "deaccessioned") {
      totalDeaccessioned++;
      continue;
    }
    if (inst.location.type === "physical") {
      physicalCount++;
    } else {
      digitalCount++;
    }
  }

  const totalActive = physicalCount + digitalCount;

  let ownershipStatus: OwnershipStatus;
  if (physicalCount > 0 && digitalCount > 0) {
    ownershipStatus = "physical_and_digital";
  } else if (physicalCount > 0) {
    ownershipStatus = "physical_only";
  } else if (digitalCount > 0) {
    ownershipStatus = "digital_only";
  } else {
    ownershipStatus = "unowned";
  }

  return {
    ownershipStatus,
    physicalCount,
    digitalCount,
    totalActive,
    totalDeaccessioned,
  };
}

// ── Derived status ──────────────────────────────────────────────────────────

const CATALOGUE_LABELS: Record<CatalogueStatusValue, string> = {
  tracked: "Tracked",
  shortlisted: "Shortlisted",
  wanted: "Wanted",
  on_order: "On Order",
  accessioned: "Accessioned",
  deaccessioned: "Deaccessioned",
};

const PRE_ACQUISITION_STATUSES: ReadonlySet<CatalogueStatusValue> = new Set([
  "tracked",
  "shortlisted",
  "wanted",
  "on_order",
]);

export function computeDerivedStatus(
  catalogueStatus: CatalogueStatusValue,
  ownership: OwnershipSummary,
): DerivedStatus {
  const baseLabel = CATALOGUE_LABELS[catalogueStatus];
  const hasActive = ownership.totalActive > 0;

  // Deaccessioned work that still has active copies is inconsistent
  if (catalogueStatus === "deaccessioned") {
    return {
      label: hasActive
        ? `${baseLabel} (Active Copies Remain)`
        : baseLabel,
      description: hasActive
        ? "This work is marked deaccessioned but still has active instances."
        : "This work has been removed from the collection.",
      isPartiallyHeld: false,
      isInconsistent: hasActive,
    };
  }

  // Accessioned work with no active copies
  if (catalogueStatus === "accessioned" && !hasActive) {
    return {
      label: `${baseLabel} (No Active Copies)`,
      description:
        "This work is accessioned but has no active instances. All copies may have been deaccessioned.",
      isPartiallyHeld: false,
      isInconsistent: true,
    };
  }

  // Pre-acquisition status but copies already exist (partially held)
  if (PRE_ACQUISITION_STATUSES.has(catalogueStatus) && hasActive) {
    return {
      label: `${baseLabel} (Partially Held)`,
      description: `This work is marked as "${baseLabel.toLowerCase()}" but already has ${ownership.totalActive} active instance(s).`,
      isPartiallyHeld: true,
      isInconsistent: false,
    };
  }

  // Normal states
  if (catalogueStatus === "accessioned" && hasActive) {
    const formatSuffix =
      ownership.ownershipStatus === "physical_and_digital"
        ? " (Physical + Digital)"
        : ownership.ownershipStatus === "digital_only"
          ? " (Digital)"
          : "";
    return {
      label: `${baseLabel}${formatSuffix}`,
      description: `${ownership.totalActive} active instance(s) across ${ownership.physicalCount} physical and ${ownership.digitalCount} digital location(s).`,
      isPartiallyHeld: false,
      isInconsistent: false,
    };
  }

  // Pre-acquisition with no copies (expected state)
  return {
    label: baseLabel,
    description: `This work is ${baseLabel.toLowerCase()} and has no copies in the collection.`,
    isPartiallyHeld: false,
    isInconsistent: false,
  };
}

// ── Status config maps ──────────────────────────────────────────────────────

export function getCatalogueStatusConfig(
  status: CatalogueStatusValue,
): { label: string; icon: string; color: string } {
  const config: Record<
    CatalogueStatusValue,
    { label: string; icon: string; color: string }
  > = {
    tracked: { label: "Tracked", icon: "bookmark", color: "var(--color-fg-secondary)" },
    shortlisted: {
      label: "Shortlisted",
      icon: "list-checks",
      color: "var(--color-accent-blue)",
    },
    wanted: { label: "Wanted", icon: "heart", color: "var(--color-accent-gold)" },
    on_order: { label: "On Order", icon: "package", color: "var(--color-accent-gold)" },
    accessioned: { label: "Accessioned", icon: "library", color: "var(--color-accent-sage)" },
    deaccessioned: {
      label: "Deaccessioned",
      icon: "archive",
      color: "var(--color-accent-primary)",
    },
  };
  return config[status];
}

export function getAcquisitionPriorityConfig(
  priority: "none" | "low" | "medium" | "high" | "urgent",
): { label: string; icon: string; color: string } {
  const config: Record<
    "none" | "low" | "medium" | "high" | "urgent",
    { label: string; icon: string; color: string }
  > = {
    none: { label: "None", icon: "minus", color: "var(--color-fg-secondary)" },
    low: { label: "Low", icon: "signal-low", color: "var(--color-accent-blue)" },
    medium: { label: "Medium", icon: "signal-medium", color: "var(--color-accent-gold)" },
    high: { label: "High", icon: "signal-high", color: "var(--color-accent-gold)" },
    urgent: { label: "Urgent", icon: "alert-circle", color: "var(--color-accent-red-text)" },
  };
  return config[priority];
}

export function getInstanceStatusConfig(
  status: InstanceStatusValue,
): { label: string; icon: string; color: string } {
  const config: Record<
    InstanceStatusValue,
    { label: string; icon: string; color: string }
  > = {
    available: { label: "Available", icon: "check-circle", color: "var(--color-accent-sage)" },
    lent_out: { label: "Lent Out", icon: "share-2", color: "var(--color-accent-gold)" },
    in_transit: { label: "In Transit", icon: "truck", color: "var(--color-accent-blue)" },
    in_storage: { label: "In Storage", icon: "box", color: "var(--color-accent-slate)" },
    missing: { label: "Missing", icon: "search", color: "var(--color-accent-red-text)" },
    damaged: { label: "Damaged", icon: "alert-triangle", color: "var(--color-accent-gold)" },
    deaccessioned: {
      label: "Deaccessioned",
      icon: "x-circle",
      color: "var(--color-accent-primary)",
    },
  };
  return config[status];
}
