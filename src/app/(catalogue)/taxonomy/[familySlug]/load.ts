import { getTaxonomyTerm } from "@/lib/actions/taxonomy-browse";
import { cache } from "react";
import { loadTaxonomyFamily } from "@/lib/catalogue/taxonomy-read";

/**
 * One read of the family and of the item per request, shared by the layouts
 * (which answer 404 before a page's loading state starts the response), the
 * pages and their titles.
 */
export const loadFamily = loadTaxonomyFamily;
export const loadItem = cache(getTaxonomyTerm);
