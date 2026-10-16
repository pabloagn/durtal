import { SectionHeading } from "@/components/shared/section-heading";
import { DetailFacts } from "@/components/shared/detail-facts";
import Link from "next/link";
import { EditionPublishers } from "@/components/publishers/edition-publishers";
import type { PublisherOption } from "@/components/publishers/publisher-picker";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InstanceDetail, type CopyEbook } from "./instance-detail";
import { EditionEditDialog } from "./edition-edit-dialog";
import { EditionCoverDialog } from "./edition-cover-dialog";
import { EditionActionsMenu } from "./edition-actions-menu";
import { EditionQuotes } from "./edition-quotes";
import { InstanceAddDialog } from "./instance-add-dialog";
import { formatDimensions, formatDate } from "@/lib/utils/format";
import { languageName } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";
import { enumLabel } from "@/lib/utils/labels";
import { isPlaceholderEdition } from "@/lib/match/identify";
import { EditionCover } from "@/components/books/edition-cover";
import type { PosterImage } from "@/lib/utils/edition-image";
import { sanitizeDescriptionHtml } from "@/lib/utils/sanitize";
import type {
  Edition,
  Instance,
  Author,
  Genre,
  Tag,
  Location,
  SubLocation,
} from "@/lib/types/index";
import type { InferSelectModel } from "drizzle-orm";
import type { editionContributors } from "@/lib/db/schema";
import type { LocationWithSubLocations } from "@/lib/types/index";

type Contributor = InferSelectModel<typeof editionContributors> & {
  author: Author;
};

type InstanceWithLocation = Instance & {
  location: Location;
  subLocation: SubLocation | null;
};

type EditionFull = Edition & {
  publisherLinks?: { publisher: PublisherOption }[];
  instances: InstanceWithLocation[];
  contributors: Contributor[];
  editionGenres: { genre: Genre }[];
  editionTags: { tag: Tag }[];
};

interface EditionDetailCardProps {
  edition: EditionFull;
  /** The book's active poster, shown when the edition has no cover */
  poster?: PosterImage | null;
  workId?: string;
  authorName?: string;
  availableLocations?: LocationWithSubLocations[];
  /** The edition's quotes and notes, on a book that allows reading (SLN-480): its Quotes row, and the delete's warning */
  quotes?: { quotes: number; notes: number; href: string };
  /** The e-book linked to each copy, by copy id */
  ebooksByCopy?: Record<string, CopyEbook>;
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <>
      <dt className="text-xs text-fg-secondary">{label}</dt>
      <dd className="text-xs text-fg-primary">{children}</dd>
    </>
  );
}

export function EditionDetailCard({
  edition,
  poster,
  workId,
  authorName,
  availableLocations = [],
  quotes,
  ebooksByCopy,
}: EditionDetailCardProps) {
  const dimensions = formatDimensions(
    edition.heightMm,
    edition.widthMm,
    edition.depthMm,
  );

  const publicationDateFormatted = formatDate(edition.publicationDate);

  const hasDetailGrid =
    edition.pageCount ||
    dimensions ||
    edition.weightGrams ||
    edition.editionName ||
    edition.editionNumber ||
    edition.printingNumber ||
    edition.publicationCountry ||
    publicationDateFormatted ||
    edition.isTranslated ||
    edition.illustrationType ||
    (edition.isLimitedEdition && edition.limitedEditionCount);

  const hasGenres = edition.editionGenres.length > 0;
  const hasTags = edition.editionTags.length > 0;
  const hasContributors = edition.contributors.length > 0;

  // Group contributors by role
  const contributorsByRole = edition.contributors.reduce<
    Record<string, Contributor[]>
  >((acc, c) => {
    if (!acc[c.role]) acc[c.role] = [];
    acc[c.role]!.push(c);
    return acc;
  }, {});

  // Actions show where the card sits on a work page
  const hasActionProps = workId !== undefined || availableLocations.length > 0;

  const hasIdentifiers = !!(
    edition.isbn13 ||
    edition.isbn10 ||
    edition.isFirstEdition ||
    edition.isLimitedEdition
  );

  return (
    <Card>
      <CardHeader className="@container">
        <div className="grid grid-cols-1 gap-4 @min-[400px]:grid-cols-[64px_minmax(0,1fr)]">
          <EditionCover
            edition={edition}
            poster={poster}
            title={edition.title}
          />
          <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
            <div>
              <h3 className="type-item-title">
                {edition.title}
                {edition.subtitle && (
                  <span className="text-fg-secondary">
                    : {edition.subtitle}
                  </span>
                )}
              </h3>
              <div id={`edition-${edition.id}`} className="mt-1.5 scroll-mt-8">
                <EditionPublishers
                  editionId={edition.id}
                  confirmed={edition.publisherLinksConfirmed}
                  publicationNames={[edition.publisher, edition.imprint].filter(
                    (name): name is string => !!name,
                  )}
                  linked={edition.publisherLinks?.map((l) => l.publisher)}
                  command={!hasActionProps}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
                {edition.publicationYear && (
                  <span className="font-mono">{edition.publicationYear}</span>
                )}
                {edition.language && (
                  <Badge variant="blue">{languageName(edition.language)}</Badge>
                )}
                {edition.binding && (
                  <Badge variant="muted">{bindingLabel(edition.binding)}</Badge>
                )}
                {isPlaceholderEdition(edition) && (
                  <>
                    <Badge variant="gold">Edition not identified</Badge>
                    <Link
                      href={`/library/identify?edition=${edition.id}`}
                      className="text-command"
                    >
                      Identify
                    </Link>
                  </>
                )}
              </div>
            </div>

            {hasIdentifiers && (
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 text-xs text-fg-secondary">
                {edition.isbn13 && (
                  <span>
                    ISBN-13{" "}
                    <span className="font-mono text-fg-primary">
                      {edition.isbn13}
                    </span>
                  </span>
                )}
                {edition.isbn10 && (
                  <span>
                    ISBN-10{" "}
                    <span className="font-mono text-fg-primary">
                      {edition.isbn10}
                    </span>
                  </span>
                )}
                {edition.isFirstEdition && (
                  <Badge variant="gold">1st ed.</Badge>
                )}
                {edition.isLimitedEdition && (
                  <Badge variant="accent">Limited</Badge>
                )}
              </div>
            )}

            {hasActionProps && (
              // Ghost buttons: the first one's ink starts at the text edge,
              // on every row when they wrap, and the menu's icon ends at the
              // right one (6px inset at 28px, 14px at 44px on touch)
              <div
                role="group"
                aria-label={`Actions for ${edition.title}`}
                className="-ml-2.5 -mr-1.5 flex flex-wrap items-center gap-1 pointer-coarse:-mr-3.5"
              >
                <EditionEditDialog edition={edition} />
                <EditionCoverDialog edition={edition} poster={poster} />
                {/* Add instance and the menu wrap together: a narrow row
                    keeps the menu at the right, beside a labelled button */}
                <div className="flex flex-[1_0_auto] items-center gap-1">
                  <InstanceAddDialog
                    workId={edition.workId}
                    editionId={edition.id}
                    editionTitle={edition.title}
                    availableLocations={availableLocations}
                  />
                  <div className="ml-auto">
                    <EditionActionsMenu
                      editionId={edition.id}
                      editionTitle={edition.title}
                      workId={workId}
                      authorName={authorName ?? ""}
                      metadataSource={edition.metadataSource}
                      hasPublisherLinks={!!edition.publisherLinks?.length}
                      instanceCount={edition.instances.length}
                      quoteCount={quotes?.quotes ?? 0}
                      noteCount={quotes?.notes ?? 0}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      {(hasDetailGrid || hasContributors) && (
        <div className="border-b border-glass-border px-5 py-4">
          <SectionHeading as="h4" title="Publication details" />
          <DetailFacts>
            {Object.entries(contributorsByRole).map(([role, contributors]) => (
              <DetailRow key={role} label={enumLabel(role)}>
                {contributors.map((c, i) => (
                  <span key={`${c.authorId}-${c.role}`}>
                    {i > 0 && ", "}
                    {c.author.slug ? (
                      <Link href={`/people/${c.author.slug}`} className="text-command">
                        {c.author.name}
                      </Link>
                    ) : (
                      c.author.name
                    )}
                  </span>
                ))}
              </DetailRow>
            ))}
            {edition.pageCount && (
              <DetailRow label="Pages">
                <span className="font-mono">{edition.pageCount}</span>
              </DetailRow>
            )}
            {dimensions && (
              <DetailRow label="Dimensions">
                <span className="font-mono">{dimensions}</span>
              </DetailRow>
            )}
            {edition.weightGrams && (
              <DetailRow label="Weight">
                <span className="font-mono">{edition.weightGrams} g</span>
              </DetailRow>
            )}
            {edition.editionName && (
              <DetailRow label="Edition name">{edition.editionName}</DetailRow>
            )}
            {edition.editionNumber && (
              <DetailRow label="Edition number">
                <span className="font-mono">{edition.editionNumber}</span>
              </DetailRow>
            )}
            {edition.printingNumber && (
              <DetailRow label="Printing number">
                <span className="font-mono">{edition.printingNumber}</span>
              </DetailRow>
            )}
            {edition.publicationCountry && (
              <DetailRow label="Country">
                {edition.publicationCountry}
              </DetailRow>
            )}
            {publicationDateFormatted && (
              <DetailRow label="Publication date">
                <span className="font-mono">{publicationDateFormatted}</span>
              </DetailRow>
            )}
            {edition.isTranslated && (
              <DetailRow label="Translated">Yes</DetailRow>
            )}
            {edition.illustrationType && (
              <DetailRow label="Illustrations">
                {edition.illustrationType}
              </DetailRow>
            )}
            {edition.isLimitedEdition && edition.limitedEditionCount && (
              <DetailRow label="Limited edition count">
                <span className="font-mono">{edition.limitedEditionCount}</span>
              </DetailRow>
            )}
          </DetailFacts>
        </div>
      )}

      {/* Edition description (if different from work) */}
      {edition.description && (
        <div className="border-b border-glass-border px-5 py-4">
          <div
            className="max-w-2xl text-sm leading-relaxed text-fg-secondary [&_a]:text-accent-primary [&_a]:underline"
            dangerouslySetInnerHTML={{
              __html: sanitizeDescriptionHtml(edition.description),
            }}
          />
        </div>
      )}

      {/* Genres & tags */}
      {(hasGenres || hasTags) && (
        <div className="border-b border-glass-border px-5 py-4">
          <div className="space-y-4">
            {hasGenres && (
              <div>
                <SectionHeading as="h4" title="Genres" />
                <div className="flex flex-wrap gap-1.5">
                  {edition.editionGenres.map(({ genre }) => (
                    <Badge key={genre.id} variant="default">
                      {genre.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {hasTags && (
              <div>
                <SectionHeading as="h4" title="Tags" />
                <div className="flex flex-wrap gap-1.5">
                  {edition.editionTags.map(({ tag }) => (
                    <Badge key={tag.id} variant="muted">
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {quotes && <EditionQuotes editionId={edition.id} {...quotes} />}

      {/* Instances */}
      <CardContent>
        <SectionHeading
          as="h4"
          title="Copies"
          count={edition.instances.length}
        />
        {edition.instances.length > 0 ? (
          <div className="space-y-2">
            {edition.instances.map((instance) => (
              <InstanceDetail
                key={instance.id}
                instance={instance}
                workId={edition.workId}
                workTitle={edition.title}
                availableLocations={availableLocations}
                ebook={ebooksByCopy?.[instance.id] ?? null}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-secondary">No copies recorded</p>
        )}
      </CardContent>
    </Card>
  );
}
