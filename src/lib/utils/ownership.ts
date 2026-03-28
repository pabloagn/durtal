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
  calibreId: number | null;
  calibreUrl: string | null;
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

export interface LocationGroup {
  locationId: string;
  locationName: string;
  locationType: "physical" | "digital";
  locationColor: string | null;
  locationIcon: string | null;
  instances: {
    id: string;
    status: InstanceStatusValue;
    format: string | null;
    calibreUrl: string | null;
    subLocationName: string | null;
  }[];
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

// ── Group instances by location ─────────────────────────────────────────────

export function groupInstancesByLocation(
  instances: InstanceWithLocation[],
): { physical: LocationGroup[]; digital: LocationGroup[] } {
  const locationMap = new Map<string, LocationGroup>();

  for (const inst of instances) {
    if (inst.status === "deaccessioned") continue;

    let group = locationMap.get(inst.location.id);
    if (!group) {
      group = {
        locationId: inst.location.id,
        locationName: inst.location.name,
        locationType: inst.location.type,
        locationColor: inst.location.color,
        locationIcon: inst.location.icon,
        instances: [],
      };
      locationMap.set(inst.location.id, group);
    }

    group.instances.push({
      id: inst.id,
      status: inst.status,
      format: inst.format,
      calibreUrl: inst.calibreUrl,
      subLocationName: inst.subLocation?.name ?? null,
    });
  }

  const groups = Array.from(locationMap.values());
  const physical = groups
    .filter((g) => g.locationType === "physical")
    .sort((a, b) => a.locationName.localeCompare(b.locationName));
  const digital = groups
    .filter((g) => g.locationType === "digital")
    .sort((a, b) => a.locationName.localeCompare(b.locationName));

  return { physical, digital };
}

// ── Calibre link aggregation ────────────────────────────────────────────────

export function aggregateCalibreLinks(
  instances: InstanceWithLocation[],
): {
  calibreUrl: string | null;
  calibreId: number | null;
  format: string | null;
  locationName: string;
}[] {
  return instances
    .filter(
      (inst) =>
        inst.location.type === "digital" &&
        (inst.calibreUrl !== null || inst.calibreId !== null),
    )
    .map((inst) => ({
      calibreUrl: inst.calibreUrl,
      calibreId: inst.calibreId,
      format: inst.format,
      locationName: inst.location.name,
    }));
}

// ── Status config maps ──────────────────────────────────────────────────────

export function getCatalogueStatusConfig(
  status: CatalogueStatusValue,
): { label: string; icon: string; color: string } {
  const config: Record<
    CatalogueStatusValue,
    { label: string; icon: string; color: string }
  > = {
    tracked: { label: "Tracked", icon: "bookmark", color: "#6b7280" },
    shortlisted: {
      label: "Shortlisted",
      icon: "list-checks",
      color: "#648493",
    },
    wanted: { label: "Wanted", icon: "heart", color: "#c0a36e" },
    on_order: { label: "On Order", icon: "package", color: "#b07d4f" },
    accessioned: { label: "Accessioned", icon: "library", color: "#76946a" },
    deaccessioned: {
      label: "Deaccessioned",
      icon: "archive",
      color: "#7d3d52",
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
    none: { label: "None", icon: "minus", color: "#6b7280" },
    low: { label: "Low", icon: "signal-low", color: "#648493" },
    medium: { label: "Medium", icon: "signal-medium", color: "#c0a36e" },
    high: { label: "High", icon: "signal-high", color: "#b07d4f" },
    urgent: { label: "Urgent", icon: "alert-circle", color: "#a65454" },
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
    available: { label: "Available", icon: "check-circle", color: "#76946a" },
    lent_out: { label: "Lent Out", icon: "share-2", color: "#c0a36e" },
    in_transit: { label: "In Transit", icon: "truck", color: "#648493" },
    in_storage: { label: "In Storage", icon: "box", color: "#586e75" },
    missing: { label: "Missing", icon: "search", color: "#a65454" },
    damaged: { label: "Damaged", icon: "alert-triangle", color: "#b07d4f" },
    deaccessioned: {
      label: "Deaccessioned",
      icon: "x-circle",
      color: "#7d3d52",
    },
  };
  return config[status];
}
