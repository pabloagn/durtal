import Link from "next/link";
import * as LucideIcons from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CapAligned } from "@/components/shared/cap-aligned";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import {
  taxonomyScopeLabel,
  type TaxonomyLevel,
} from "@/lib/catalogue/taxonomies";

interface FamilyCardProps {
  family: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    isSystem: boolean;
    entityLevel: string;
    hierarchical: boolean;
    itemCount: number;
    entityCount: number;
    scopes: { kind: WorkKind; level: TaxonomyLevel }[];
  };
}

export function FamilyCard({ family }: FamilyCardProps) {
  const enabled = new Set<WorkKind>(getEnabledWorkKinds());
  const appliesTo = family.scopes
    .filter((scope) => enabled.has(scope.kind))
    .map((scope) => taxonomyScopeLabel(scope.kind, scope.level))
    .join(", ");
  // Resolve Lucide icon by name, fallback to Tag
  const IconComponent: LucideIcons.LucideIcon = family.icon
    ? (((LucideIcons as Record<string, unknown>)[
        family.icon
      ] as LucideIcons.LucideIcon) ?? LucideIcons.Tag)
    : LucideIcons.Tag;

  return (
    <Link
      href={`/taxonomy/${family.slug}`}
      className="group block rounded-sm border border-glass-border bg-bg-secondary/60 p-4 transition-all hover:border-fg-muted/10 hover:bg-bg-tertiary/40"
    >
      {/* Header row: icon + name + system badge. The row carries the name's
          type: the icon tile sits on the name's cap-height center */}
      <div className="flex items-start gap-3 font-serif text-base">
        <CapAligned height={32}>
          <div
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm"
            style={{
              backgroundColor: family.color
                ? `${family.color}15`
                : "rgba(193, 198, 196, 0.03)",
              borderColor: family.color
                ? `${family.color}20`
                : "rgba(193, 198, 196, 0.06)",
              borderWidth: "1px",
            }}
          >
            <IconComponent
              className="h-4 w-4"
              strokeWidth={1.5}
              style={{ color: family.color ?? undefined }}
            />
          </div>
        </CapAligned>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate font-serif text-base text-fg-primary transition-colors group-hover:text-accent-rose-text">
              {family.name}
            </h3>
            {family.isSystem && (
              <Badge variant="muted" className="flex-shrink-0">
                System
              </Badge>
            )}
          </div>
          {/* Two lines kept even without a description: equal card heights */}
          <p className="mt-0.5 lines-2 text-xs leading-relaxed text-fg-secondary">
            {family.description}
          </p>
          <p className="mt-0.5 lines-1 text-xs text-fg-secondary">{appliesTo}</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-3 flex items-center gap-3 overflow-hidden whitespace-nowrap border-t border-glass-border/40 pt-2.5">
        <span className="font-mono text-micro text-fg-secondary">
          {family.itemCount} item{family.itemCount === 1 ? "" : "s"}
        </span>
        <span className="text-fg-muted/30">|</span>
        <span className="font-mono text-micro text-fg-secondary">
          {family.entityCount} classified
        </span>
        {family.hierarchical && (
          <>
            <span className="text-fg-muted/30">|</span>
            <span className="font-mono text-micro text-fg-secondary">
              hierarchical
            </span>
          </>
        )}
      </div>
    </Link>
  );
}
