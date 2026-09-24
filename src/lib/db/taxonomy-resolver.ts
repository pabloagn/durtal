import {
  subjects,
  genres,
  tags,
  bookCategories,
  themes,
  literaryMovements,
  artTypes,
  artMovements,
  keywords,
  attributes,
  workSubjects,
  editionGenres,
  editionTags,
  workCategories,
  workThemes,
  workLiteraryMovements,
  workArtTypes,
  workArtMovements,
  workKeywords,
  workAttributes,
} from "@/lib/db/schema";

// ── Registry mapping system family slugs to their backing tables ────────────

const SYSTEM_REGISTRY = {
  subjects: {
    table: subjects,
    junction: workSubjects,
    junctionItemCol: workSubjects.subjectId,
    junctionEntityCol: workSubjects.workId,
  },
  genres: {
    table: genres,
    junction: editionGenres,
    junctionItemCol: editionGenres.genreId,
    junctionEntityCol: editionGenres.editionId,
  },
  tags: {
    table: tags,
    junction: editionTags,
    junctionItemCol: editionTags.tagId,
    junctionEntityCol: editionTags.editionId,
  },
  categories: {
    table: bookCategories,
    junction: workCategories,
    junctionItemCol: workCategories.categoryId,
    junctionEntityCol: workCategories.workId,
  },
  themes: {
    table: themes,
    junction: workThemes,
    junctionItemCol: workThemes.themeId,
    junctionEntityCol: workThemes.workId,
  },
  "literary-movements": {
    table: literaryMovements,
    junction: workLiteraryMovements,
    junctionItemCol: workLiteraryMovements.literaryMovementId,
    junctionEntityCol: workLiteraryMovements.workId,
  },
  "art-types": {
    table: artTypes,
    junction: workArtTypes,
    junctionItemCol: workArtTypes.artTypeId,
    junctionEntityCol: workArtTypes.workId,
  },
  "art-movements": {
    table: artMovements,
    junction: workArtMovements,
    junctionItemCol: workArtMovements.artMovementId,
    junctionEntityCol: workArtMovements.workId,
  },
  keywords: {
    table: keywords,
    junction: workKeywords,
    junctionItemCol: workKeywords.keywordId,
    junctionEntityCol: workKeywords.workId,
  },
  attributes: {
    table: attributes,
    junction: workAttributes,
    junctionItemCol: workAttributes.attributeId,
    junctionEntityCol: workAttributes.workId,
  },
} as const;

export type SystemFamilySlug = keyof typeof SYSTEM_REGISTRY;

export function isSystemFamily(slug: string): slug is SystemFamilySlug {
  return slug in SYSTEM_REGISTRY;
}

export function getSystemRegistry(slug: SystemFamilySlug) {
  return SYSTEM_REGISTRY[slug];
}
