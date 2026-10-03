"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Library, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CapAligned } from "@/components/shared/cap-aligned";
import {
  EntityActionMenu,
  type EntityActionItem,
} from "@/components/shared/entity-action-menu";
import { PublisherFavourite } from "@/components/publishers/favourite-button";

interface PublisherDetailHeaderProps {
  id: string;
  slug: string;
  name: string;
  kind: string;
  country: string | null;
  website: string | null;
  isFavourite: boolean;
  parent: { name: string; slug: string } | null;
  specialties: { id: string; name: string }[];
}

export function PublisherDetailHeader({
  id,
  slug,
  name,
  kind,
  country,
  website,
  isFavourite,
  parent,
  specialties,
}: PublisherDetailHeaderProps) {
  const router = useRouter();
  const safeWebsite = website && /^https?:\/\//i.test(website) ? website : null;

  const actionItems: EntityActionItem[] = [
    {
      label: "Edit",
      icon: Pencil,
      onClick: () => router.push(`/publishers/${slug}/edit`),
    },
    {
      label: "View in Library",
      icon: Library,
      onClick: () => router.push(`/library?publisher=${id}`),
    },
    ...(safeWebsite
      ? [
          {
            label: "Visit Website",
            icon: ExternalLink,
            onClick: () =>
              window.open(safeWebsite, "_blank", "noopener,noreferrer"),
          },
        ]
      : []),
  ];

  return (
    <header className="mb-8">
      {/* The row carries the name's type: the star and the menu sit on the
          cap-height center of the name's first line */}
      <div className="flex items-start gap-4 font-serif text-4xl tracking-tight">
        <div className="flex min-w-0 flex-1 items-start gap-1">
          <h1 className="min-w-0 break-words font-serif text-4xl tracking-tight text-fg-primary">
            {name}
          </h1>
          <CapAligned height={32}>
            <PublisherFavourite id={id} favourite={isFavourite} />
          </CapAligned>
        </div>
        <CapAligned height={32}>
          <EntityActionMenu items={actionItems} />
        </CapAligned>
      </div>

      {(country || kind === "imprint" || parent) && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {country && (
            <span className="font-medium text-fg-primary">{country}</span>
          )}
          {kind === "imprint" && <Badge variant="blue">Imprint</Badge>}
          {parent && (
            <span className="text-fg-secondary">
              Imprint of{" "}
              <Link
                href={`/publishers/${parent.slug}`}
                className="text-fg-primary transition-colors hover:text-accent-rose"
              >
                {parent.name}
              </Link>
            </span>
          )}
        </div>
      )}

      {specialties.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {specialties.map((s) => (
            <Badge key={s.id} variant="muted">
              {s.name}
            </Badge>
          ))}
        </div>
      )}
    </header>
  );
}
