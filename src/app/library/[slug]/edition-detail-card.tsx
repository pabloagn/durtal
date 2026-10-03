import { CollectionButton } from "@/components/books/add-to-collection-dialog";
import { ImageAdjustButton } from "@/components/media/image-adjustment-editor";
import Link from "next/link";
import { EditionPublishers } from "@/components/publishers/edition-publishers";
import type { PublisherOption } from "@/components/publishers/publisher-picker";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InstanceDetail } from "./instance-detail";
import { EditionEditDialog } from "./edition-edit-dialog";
import { EditionDeleteButton } from "./edition-delete-button";
import { InstanceAddDialog } from "./instance-add-dialog";
import { EditionMatchButton } from "./edition-match-button";
import { formatDimensions, formatDate } from "@/lib/utils/format";
import { languageName } from "@/lib/utils/language";
import { bindingLabel } from "@/lib/utils/binding";
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
  availableGenres?: { id: string; name: string }[];
  availableTags?: { id: string; name: string }[];
}

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <>
      <dt className="text-xs text-fg-secondary">{label}</dt>
      <dd className="text-sm text-fg-secondary">{children}</dd>
    </>
  );
}

export function EditionDetailCard({
  edition,
  poster,
  workId,
  authorName,
  availableLocations = [],
  availableGenres = [],
  availableTags = [],
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
  const hasActionProps =
    workId !== undefined || availableLocations.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex gap-4">
          <EditionCover
            edition={edition}
            poster={poster}
            title={edition.title}
          />
          <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="type-item-title">
                {edition.title}
                {edition.subtitle && (
                  <span className="text-fg-secondary">
                    : {edition.subtitle}
                  </span>
                )}
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
                {edition.publisher && <span>{edition.publisher}</span>}
                {edition.imprint && edition.imprint !== edition.publisher && (
                  <span className="text-fg-secondary">{edition.imprint}</span>
                )}
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
                      className="text-accent-blue"
                    >
                      Identify
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Right side: ISBN badges + action buttons */}
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {edition.isbn13 && (
                  <span className="font-mono text-xs text-fg-secondary">
                    {edition.isbn13}
                  </span>
                )}
                {edition.isFirstEdition && (
                  <Badge variant="gold">1st ed.</Badge>
                )}
                {edition.isLimitedEdition && (
                  <Badge variant="rose">Limited</Badge>
                )}
              </div>
              {hasActionProps && (
                <div className="flex items-center gap-1">
                  <CollectionButton
                    editionId={edition.id}
                    title={edition.title}
                  />
                  {(edition.coverS3Key || edition.thumbnailS3Key) && (
                    <ImageAdjustButton
                      source={`/api/s3/read?key=${encodeURIComponent((edition.coverS3Key || edition.thumbnailS3Key)!)}`}
                      label="Adjust edition cover"
                    />
                  )}
                  {workId && (
                    <EditionMatchButton
                      workId={workId}
                      editionId={edition.id}
                      currentTitle={edition.title}
                      currentAuthor={authorName ?? ""}
                      currentMetadataSource={edition.metadataSource}
                    />
                  )}
                  <EditionEditDialog
                    edition={edition}
                    availableGenres={availableGenres}
                    availableTags={availableTags}
                  />
                  <InstanceAddDialog
                    editionId={edition.id}
                    editionTitle={edition.title}
                    availableLocations={availableLocations}
                  />
                  <EditionDeleteButton
                    editionId={edition.id}
                    editionTitle={edition.title}
                    instanceCount={edition.instances.length}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      {hasDetailGrid && (
        <div className="border-b border-glass-border px-4 py-3">
          <p className="type-caption mb-2">
            Publication Details
          </p>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1.5">
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
              <DetailRow label="Edition Name">{edition.editionName}</DetailRow>
            )}
            {edition.editionNumber && (
              <DetailRow label="Edition Number">
                <span className="font-mono">{edition.editionNumber}</span>
              </DetailRow>
            )}
            {edition.printingNumber && (
              <DetailRow label="Printing Number">
                <span className="font-mono">{edition.printingNumber}</span>
              </DetailRow>
            )}
            {edition.publicationCountry && (
              <DetailRow label="Country">
                {edition.publicationCountry}
              </DetailRow>
            )}
            {publicationDateFormatted && (
              <DetailRow label="Publication Date">
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
              <DetailRow label="Limited Edition Count">
                <span className="font-mono">{edition.limitedEditionCount}</span>
              </DetailRow>
            )}
          </dl>
        </div>
      )}

      {/* Edition description (if different from work) */}
      {edition.description && (
        <div className="border-b border-glass-border px-4 py-3">
          <div
            className="max-w-2xl text-sm leading-relaxed text-fg-secondary [&_a]:text-accent-rose [&_a]:underline"
            dangerouslySetInnerHTML={{
              __html: sanitizeDescriptionHtml(edition.description),
            }}
          />
        </div>
      )}

      {/* Genres & Tags */}
      {(hasGenres || hasTags) && (
        <div className="border-b border-glass-border px-4 py-3">
          <div className="space-y-2">
            {hasGenres && (
              <div>
                <p className="type-caption mb-1">
                  Genres
                </p>
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
                <p className="type-caption mb-1">
                  Tags
                </p>
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

      {/* Contributors */}
      {hasContributors && (
        <div className="border-b border-glass-border px-4 py-3">
          <div className="flex flex-wrap gap-4">
            {Object.entries(contributorsByRole).map(([role, contributors]) => (
              <div key={role}>
                <span className="text-xs text-fg-secondary capitalize">
                  {role}:{" "}
                </span>
                {contributors.map((c, i) => (
                  <span key={`${c.authorId}-${c.role}`}>
                    {i > 0 && ", "}
                    {c.author.slug ? (
                      <Link
                        href={`/authors/${c.author.slug}`}
                        className="text-xs text-fg-secondary transition-colors hover:text-accent-rose-text"
                      >
                        {c.author.name}
                      </Link>
                    ) : (
                      <span className="text-xs text-fg-secondary">
                        {c.author.name}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Instances */}
      <CardContent>
        <div id={`edition-${edition.id}`} className="mb-4 scroll-mt-8">
          <EditionPublishers
            editionId={edition.id}
            confirmed={edition.publisherLinksConfirmed}
            linked={edition.publisherLinks?.map((l) => l.publisher)}
          />
        </div>
        {edition.instances.length > 0 ? (
          <div className="space-y-2">
            {edition.instances.map((instance) => (
              <InstanceDetail
                key={instance.id}
                instance={instance}
                availableLocations={availableLocations}
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
