import { cache } from "react";
import { getTaxonomyFamily } from "@/lib/actions/taxonomy-families";
/** One family lookup per render, shared by layout, metadata and paged queries. */
export const loadTaxonomyFamily = cache(getTaxonomyFamily);
