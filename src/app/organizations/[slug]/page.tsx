import { cache, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";
import { Prose } from "@/components/shared/prose";
import { SectionHeading } from "@/components/shared/section-heading";
import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import {
  DetailColumns,
  RecordField,
  RecordFields,
  RecordGroup,
  RecordPanel,
} from "@/components/shared/detail-layout";
import { PerfumeCard } from "@/components/perfumes/perfume-card";
import { FilmCard } from "@/components/films/film-card";
import { PaintingCard } from "@/components/paintings/painting-card";
import { OrganizationActions } from "@/components/organizations/organization-actions";
import { getOrganization } from "@/lib/actions/organizations";
import { getOrganizationContributions } from "@/lib/actions/organization-directory";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import {
  NON_PUBLISHING_ROLES,
  ORGANIZATION_ROLE_LABELS,
  organizationRoleText,
  type DirectoryRole,
} from "@/lib/catalogue/organizations";
import { VENUE_TYPE_LABELS } from "@/lib/catalogue/venues";

const LINK = "text-accent-rose-text transition-colors hover:text-fg-primary";

/** One read per request for the page and its title; a malformed or overlong address finds nothing */
const loadOrganization = cache(async (slug: string) => {
  let key: string;
  try {
    key = decodeURIComponent(slug);
  } catch {
    return undefined;
  }
  return key && key.length <= 500 ? getOrganization(key) : undefined;
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const organization = await loadOrganization((await params).slug);
  return { title: organization?.name ?? "Organization not found" };
}

/** "3 bottles", "1 copy" */
function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What a publishing profile holds: "Publisher of 82 editions of 82 books.",
 * "Publishing group with 3 houses under it: 120 editions of 98 books in all."
 */
function bookSentence(
  label: string,
  p: { editions: number; books: number; children: unknown[]; familyEditions: number; familyBooks: number },
) {
  if (p.children.length)
    return p.familyEditions
      ? `${label} with ${count(p.children.length, "house", "houses")} under it: ${count(p.familyEditions, "edition", "editions")} of ${count(p.familyBooks, "book", "books")} in all.`
      : `${label} with ${count(p.children.length, "house", "houses")} under it, with no edition in the catalogue yet.`;
  return p.editions
    ? `${label} of ${count(p.editions, "edition", "editions")} of ${count(p.books, "book", "books")}.`
    : `${label}, with no edition in the catalogue yet.`;
}

/** A collection's part of the page: its heading, then its rows */
function Part({
  title,
  icon,
  description,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="mb-12">
      <SectionHeading title={title} icon={icon} description={description} />
      {children && <div className="space-y-8">{children}</div>}
    </section>
  );
}

/** A row of cards inside a part, with the full count when it holds fewer */
function Row({
  title,
  href,
  total,
  width,
  children,
}: {
  title: string;
  href?: string;
  total: number;
  width: string;
  children: ReactNode[];
}) {
  if (!children.length) return null;
  return (
    <HorizontalCarousel as="h3" title={title} titleHref={href} count={total}>
      {children.map((child, i) => (
        <div key={i} className={`${width} flex-shrink-0 snap-start`}>
          {child}
        </div>
      ))}
    </HorizontalCarousel>
  );
}

/**
 * An organization across the collections: its roles, then one part per
 * collection it takes part in (its publisher profile for books, the perfumes
 * it makes, brands or sells, the films it produces or distributes, the
 * paintings it owns or shows) and the venues it runs. Parts with nothing in
 * them are left out; an organization nothing links to says so.
 */
export default async function OrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organization = await loadOrganization(slug);
  if (!organization) notFound();
  const { publishing, perfumes, films, paintings } = await getOrganizationContributions(
    organization.id,
  );
  const open = new Set<string>(getEnabledWorkKinds());
  const kind = organization.kind as DirectoryRole | null;
  const id = organization.id;

  const houseRoles = perfumes.roles.filter((r) => r.total > 0);
  const hasPerfumes =
    open.has("perfume") && (houseRoles.length > 0 || perfumes.listings > 0 || perfumes.bottles > 0);
  const hasFilms =
    open.has("film") && (films.produced.total > 0 || films.distributed.total > 0 || films.copies > 0);
  const hasPaintings =
    open.has("painting") && (paintings.owned.objects > 0 || paintings.shown.total > 0);
  const venues = organization.venues;
  // A venue it both runs and owns is one venue
  const venueCount = new Set(venues.map((v) => v.venueId)).size;
  const linked = [
    publishing.editions && count(publishing.editions, "edition", "editions"),
    publishing.children.length &&
      count(publishing.children.length, "house under it", "houses under it"),
    publishing.wanted && count(publishing.wanted, "book wanted from it", "books wanted from it"),
    perfumes.roles.reduce((n, r) => n + r.total, 0) &&
      count(perfumes.roles.reduce((n, r) => n + r.total, 0), "perfume credit", "perfume credits"),
    perfumes.listings && count(perfumes.listings, "retailer listing", "retailer listings"),
    perfumes.bottles && count(perfumes.bottles, "bottle supplied", "bottles supplied"),
    films.produced.total && count(films.produced.total, "film produced", "films produced"),
    films.distributed.total && count(films.distributed.total, "film distributed", "films distributed"),
    films.copies && count(films.copies, "film copy supplied", "film copies supplied"),
    paintings.owned.objects && count(paintings.owned.objects, "object owned", "objects owned"),
    venueCount && count(venueCount, "venue", "venues"),
  ].filter((line): line is string => typeof line === "string");

  const website =
    organization.website && /^https?:\/\//i.test(organization.website) ? organization.website : null;
  // The country as written, like the publisher page and the directory
  const country = organization.country ?? organization.countryRef?.name ?? null;
  const roleText = organizationRoleText(organization.roles);

  const record = (
    <RecordPanel>
      <RecordGroup title="Details">
        <RecordFields>
          <RecordField label="Roles">{roleText || "None recorded"}</RecordField>
          {country && <RecordField label="Country">{country}</RecordField>}
          {organization.aliases.length > 0 && (
            <RecordField label="Other names">
              {organization.aliases.map((a) => a.name).join(" · ")}
            </RecordField>
          )}
        </RecordFields>
      </RecordGroup>
      {(website || kind) && (
        <RecordGroup title="Links">
          <ul className="space-y-1 text-sm">
            {kind && (
              <li>
                <Link href={`/publishers/${organization.slug}`} className={LINK}>
                  Publisher page
                </Link>
              </li>
            )}
            {website && (
              <li>
                <a href={website} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Website
                </a>
              </li>
            )}
          </ul>
        </RecordGroup>
      )}
    </RecordPanel>
  );

  return (
    <>
      <CopyShortcuts name={organization.name} />
      <Link
        href="/organizations"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to organizations
      </Link>

      <header className="mb-10">
        <div className="flex items-start justify-between gap-3">
          <h1 className="type-page-title min-w-0 break-words">{organization.name}</h1>
          <OrganizationActions
            organization={{
              id,
              name: organization.name,
              kind,
              roles: organization.roles.filter(
                (role): role is (typeof NON_PUBLISHING_ROLES)[number] =>
                  (NON_PUBLISHING_ROLES as readonly string[]).includes(role),
              ),
              country: organization.country,
              website: organization.website,
              description: organization.description,
              aliases: organization.aliases.map((a) => a.name),
            }}
            blockers={linked}
          />
        </div>
        {roleText && <p className="mt-1 text-sm text-fg-secondary">{roleText}</p>}
      </header>

      <DetailColumns record={record}>
        {organization.description && (
          <Prose className="mb-12 whitespace-pre-line">{organization.description}</Prose>
        )}

        {kind && (
          <Part
            title="Books"
            icon={DOMAIN_ICONS.book}
            description={
              <>
                {bookSentence(ORGANIZATION_ROLE_LABELS[kind].one, publishing)}{" "}
                <Link
                  href={`/publishers/${organization.slug}`}
                  className="text-fg-primary underline decoration-glass-border underline-offset-4 hover:text-accent-rose-text"
                >
                  Open the publisher page
                </Link>
              </>
            }
          >
            {(publishing.parent || publishing.children.length > 0) && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
                {publishing.parent && (
                  <>
                    <dt className="text-fg-secondary">
                      {kind === "imprint" ? "Imprint of" : "Part of"}
                    </dt>
                    <dd>
                      <Link href={`/organizations/${publishing.parent.slug}`} className={LINK}>
                        {publishing.parent.name}
                      </Link>
                    </dd>
                  </>
                )}
                {publishing.children.length > 0 && (
                  <>
                    <dt className="text-fg-secondary">
                      {kind === "group" ? "Publishers" : "Imprints"}
                    </dt>
                    <dd>
                      {publishing.children.map((child, i) => (
                        <span key={child.id}>
                          {i > 0 && ", "}
                          <Link href={`/organizations/${child.slug}`} className={LINK}>
                            {child.name}
                          </Link>
                        </span>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            )}
          </Part>
        )}

        {hasPerfumes && (
          <Part
            title="Perfumes"
            icon={DOMAIN_ICONS.perfume}
            description={
              [
                perfumes.listings > 0 &&
                  `${count(perfumes.listings, "retailer listing", "retailer listings")} recorded`,
                perfumes.bottles > 0 &&
                  `supplied ${count(perfumes.bottles, "bottle", "bottles")} you keep`,
              ]
                .filter(Boolean)
                .join(", ")
                .replace(/^./, (c) => c.toUpperCase()) || undefined
            }
          >
            {houseRoles.map((r) => (
              <Row
                key={r.role}
                title={`As ${ORGANIZATION_ROLE_LABELS[r.role].one.toLowerCase()}`}
                href={`/perfumes?house=${id}&houseRole=${r.role}`}
                total={r.total}
                width="w-[168px]"
              >
                {r.cards.map((perfume) => (
                  <PerfumeCard key={perfume.id} perfume={perfume} />
                ))}
              </Row>
            ))}
            <Row title="Sold here" total={perfumes.listed.total} width="w-[168px]">
              {perfumes.listed.cards.map((perfume) => (
                <PerfumeCard key={perfume.id} perfume={perfume} />
              ))}
            </Row>
          </Part>
        )}

        {hasFilms && (
          <Part
            title="Films"
            icon={DOMAIN_ICONS.film}
            description={
              films.copies > 0
                ? `Supplied ${count(films.copies, "copy", "copies")} you keep`
                : undefined
            }
          >
            <Row title="Produced" total={films.produced.total} width="w-[160px]">
              {films.produced.cards.map((film) => (
                <FilmCard key={film.id} film={film} />
              ))}
            </Row>
            <Row title="Distributed" total={films.distributed.total} width="w-[160px]">
              {films.distributed.cards.map((film) => (
                <FilmCard key={film.id} film={film} />
              ))}
            </Row>
          </Part>
        )}

        {hasPaintings && (
          <Part
            title="Paintings"
            icon={DOMAIN_ICONS.painting}
            description={
              paintings.owned.objects > 0
                ? `Owns ${count(paintings.owned.objects, "object", "objects")} in the catalogue`
                : undefined
            }
          >
            <Row
              title="In its collection"
              href={`/paintings?institution=${id}`}
              total={paintings.owned.total}
              width="w-[200px]"
            >
              {paintings.owned.cards.map((painting) => (
                <PaintingCard key={painting.id} painting={painting} />
              ))}
            </Row>
            <Row
              title="At its venues now"
              href={`/paintings?venue=${venues.map((v) => v.venueId).join(",")}`}
              total={paintings.shown.total}
              width="w-[200px]"
            >
              {paintings.shown.cards.map((painting) => (
                <PaintingCard key={painting.id} painting={painting} />
              ))}
            </Row>
          </Part>
        )}

        {venues.length > 0 && (
          <Part title="Venues" icon={Building2}>
            <ul className="divide-y divide-glass-border">
              {venues.map(({ venue, role }) => (
                <li key={`${venue.id}-${role}`} className="py-2.5">
                  {venue.slug ? (
                    <Link href={`/places/${venue.slug}`} className={`type-item-title ${LINK}`}>
                      {venue.name}
                    </Link>
                  ) : (
                    <span className="type-item-title">{venue.name}</span>
                  )}
                  <p className="text-xs text-fg-secondary">
                    {VENUE_TYPE_LABELS[venue.type]} · {role === "owner" ? "Owner" : "Operator"}
                  </p>
                </li>
              ))}
            </ul>
          </Part>
        )}

        {!kind && !hasPerfumes && !hasFilms && !hasPaintings && venues.length === 0 && (
          <p className="mb-12 text-sm text-fg-secondary">
            Nothing in the catalogue links to {organization.name} yet. Choose it as a perfume
            house, a production company, an owner of a painting or a retailer, and it shows here.
          </p>
        )}
      </DetailColumns>
    </>
  );
}
