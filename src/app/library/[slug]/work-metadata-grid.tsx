import Link from "next/link";
import type { WorkWithRelations } from "@/lib/types";
import {
  RecordField,
  RecordFields,
  RecordGroup,
} from "@/components/shared/detail-layout";
import { languageName } from "@/lib/utils/language";
import { catalogueStatusLabel, priorityLabel } from "@/lib/utils/labels";

interface WorkDetailsProps {
  work: WorkWithRelations;
}

/** The work's facts, as the first group of the book page's record */
export function WorkDetails({ work }: WorkDetailsProps) {
  const series = work.seriesId && work.series ? work.series : null;
  const position = work.seriesPosition && (
    <span className="ml-1 font-mono text-xs text-fg-secondary">
      #{work.seriesPosition}
    </span>
  );

  return (
    <RecordGroup title="Details">
      <RecordFields>
        {work.originalLanguage && (
          <RecordField label="Original language">
            {languageName(work.originalLanguage)}
          </RecordField>
        )}
        {work.originalYear && (
          <RecordField label="Original year">
            <span className="font-mono text-xs">{work.originalYear}</span>
          </RecordField>
        )}
        {work.workType && (
          <RecordField label="Work type">{work.workType.name}</RecordField>
        )}
        <RecordField label="Catalogue status">
          {catalogueStatusLabel(work.catalogueStatus)}
        </RecordField>
        {work.acquisitionPriority && work.acquisitionPriority !== "none" && (
          <RecordField label="Acquisition priority">
            {priorityLabel(work.acquisitionPriority)}
          </RecordField>
        )}
        {work.isAnthology && <RecordField label="Anthology">Yes</RecordField>}
        {series ? (
          <RecordField label="Series">
            <Link
              href={`/series/${series.id}`}
              className="transition-colors hover:text-accent-rose-text"
            >
              {series.title}
            </Link>
            {position}
          </RecordField>
        ) : (
          work.seriesName && (
            <RecordField label="Series">
              {work.seriesName}
              {position}
            </RecordField>
          )
        )}
      </RecordFields>
    </RecordGroup>
  );
}
