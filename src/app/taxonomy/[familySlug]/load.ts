import { cache } from "react";
import { getTaxonomyFamily, getTaxonomyItem } from "@/lib/actions/taxonomy-families";

/**
 * One read of the family and of the item per request, shared by the layouts
 * (which answer 404 before a page's loading state starts the response), the
 * pages and their titles.
 */
export const loadFamily = cache(getTaxonomyFamily);
export const loadItem = cache(getTaxonomyItem);
