import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { WorkWithRelations } from "@/lib/types";

interface WorkTaxonomySectionProps {
  work: WorkWithRelations;
  headerAction?: ReactNode;
}

interface TaxonomyGroupProps {
  label: string;
  items: string[];
  variant: "default" | "muted" | "blue" | "gold" | "sage" | "red";
}

function TaxonomyGroup({ label, items, variant }: TaxonomyGroupProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-fg-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Badge key={item} variant={variant}>
            {item}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function WorkTaxonomySection({
  work,
  headerAction,
}: WorkTaxonomySectionProps) {
  const subjects = work.workSubjects.map((ws) => ws.subject.name);
  const categories = work.workCategories.map((wc) => wc.category.name);
  const themes = work.workThemes.map((wt) => wt.theme.name);
  const literaryMovements = work.workLiteraryMovements.map(
    (wlm) => wlm.literaryMovement.name,
  );
  const artTypes = work.workArtTypes.map((wat) => wat.artType.name);
  const artMovements = work.workArtMovements.map((wam) => wam.artMovement.name);
  const keywordNames = work.workKeywords.map((wk) => wk.keyword.name);
  const attributeNames = work.workAttributes.map((wa) => wa.attribute.name);

  const hasAny =
    subjects.length > 0 ||
    categories.length > 0 ||
    themes.length > 0 ||
    literaryMovements.length > 0 ||
    artTypes.length > 0 ||
    artMovements.length > 0 ||
    keywordNames.length > 0 ||
    attributeNames.length > 0;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-xl text-fg-secondary">Taxonomy</h2>
        {headerAction}
      </div>
      {!hasAny && (
        <p className="text-sm text-fg-muted">No taxonomy assigned</p>
      )}
      <div className="space-y-4">
        <TaxonomyGroup label="Subjects" items={subjects} variant="default" />
        <TaxonomyGroup label="Categories" items={categories} variant="muted" />
        <TaxonomyGroup label="Themes" items={themes} variant="blue" />
        <TaxonomyGroup
          label="Literary Movements"
          items={literaryMovements}
          variant="gold"
        />
        <TaxonomyGroup label="Art Types" items={artTypes} variant="sage" />
        <TaxonomyGroup
          label="Art Movements"
          items={artMovements}
          variant="sage"
        />
        <TaxonomyGroup label="Keywords" items={keywordNames} variant="default" />
        <TaxonomyGroup label="Attributes" items={attributeNames} variant="muted" />
      </div>
    </section>
  );
}
