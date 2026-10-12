import { cache } from "react";
import { getVenueBySlug } from "@/lib/actions/venues";

/**
 * One read of the venue per request, shared by the layout (which answers 404
 * before the page's loading state starts the response), the page and its
 * title.
 */
export const loadVenue = cache(getVenueBySlug);
