import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { WorkWithRelations } from "@/lib/types";

interface WorkTaxonomySectionProps {
  work: WorkWithRelations;
  headerAction?: ReactNode;
}

interface TaxonomyItem {
  name: string;
  slug: string;
}

interface TaxonomyGroupProps {
  label: string;
  familySlug: string;
  items: TaxonomyItem[];
  variant: "default" | "muted" | "blue" | "gold" | "sage" | "red";
}

function TaxonomyGroup({ label, familySlug, items, variant }: TaxonomyGroupProps) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs uppercase tracking-wide text-fg-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <Link key={item.slug} href={`/taxonomy/${familySlug}/${item.slug}`}>
            <Badge variant={variant}>{item.name}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function WorkTaxonomySection({
  work,
  headerAction,
}: WorkTaxonomySectionProps) {
  const subjects = work.workSubjects.map((ws) => ({
    name: ws.subject.name,
    slug: ws.subject.slug,
  }));
  const categories = work.workCategories.map((wc) => ({
    name: wc.category.name,
    slug: wc.category.slug,
  }));
  const themes = work.workThemes.map((wt) => ({
    name: wt.theme.name,
    slug: wt.theme.slug,
  }));
  const literaryMovements = work.workLiteraryMovements.map((wlm) => ({
    name: wlm.literaryMovement.name,
    slug: wlm.literaryMovement.slug,
  }));
  const artTypes = work.workArtTypes.map((wat) => ({
    name: wat.artType.name,
    slug: wat.artType.slug,
  }));
  const artMovements = work.workArtMovements.map((wam) => ({
    name: wam.artMovement.name,
    slug: wam.artMovement.slug,
  }));
  const keywordItems = work.workKeywords.map((wk) => ({
    name: wk.keyword.name,
    slug: wk.keyword.slug,
  }));
  const attributeItems = work.workAttributes.map((wa) => ({
    name: wa.attribute.name,
    slug: wa.attribute.slug,
  }));

  const hasAny =
    subjects.length > 0 ||
    categories.length > 0 ||
    themes.length > 0 ||
    literaryMovements.length > 0 ||
    artTypes.length > 0 ||
    artMovements.length > 0 ||
    keywordItems.length > 0 ||
    attributeItems.length > 0;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-2xl text-fg-primary">Taxonomy</h2>
        {headerAction}
      </div>
      {!hasAny && (
        <p className="text-sm text-fg-muted">No taxonomy assigned</p>
      )}
      <div className="space-y-4">
        <TaxonomyGroup label="Subjects" familySlug="subjects" items={subjects} variant="default" />
        <TaxonomyGroup label="Categories" familySlug="categories" items={categories} variant="muted" />
        <TaxonomyGroup label="Themes" familySlug="themes" items={themes} variant="blue" />
        <TaxonomyGroup
          label="Literary Movements"
          familySlug="literary-movements"
          items={literaryMovements}
          variant="gold"
        />
        <TaxonomyGroup label="Art Types" familySlug="art-types" items={artTypes} variant="sage" />
        <TaxonomyGroup
          label="Art Movements"
          familySlug="art-movements"
          items={artMovements}
          variant="sage"
        />
        <TaxonomyGroup label="Keywords" familySlug="keywords" items={keywordItems} variant="default" />
        <TaxonomyGroup label="Attributes" familySlug="attributes" items={attributeItems} variant="muted" />
      </div>
    </section>
  );
}
