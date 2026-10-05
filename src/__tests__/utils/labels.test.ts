import { describe, expect, it } from "vitest";
import {
  catalogueStatusLabel,
  countryDisplayName,
  enumLabel,
  metadataSourceLabel,
  priorityLabel,
} from "@/lib/utils/labels";
import { formatEventDescription } from "@/lib/activity/event-config";
import { acquisitionMethodLabel, orderStatusLabel } from "@/lib/constants/orders";
import { COPY_CONDITION_LABELS, COPY_FORMAT_LABELS } from "@/lib/constants/catalogue";

describe("labels (SLN-400)", () => {
  it("labels catalogue statuses and priorities from their config", () => {
    expect(catalogueStatusLabel("on_order")).toBe("On Order");
    expect(catalogueStatusLabel("accessioned")).toBe("Accessioned");
    expect(priorityLabel("high")).toBe("High");
    expect(catalogueStatusLabel(null)).toBe("");
  });

  it("labels metadata sources", () => {
    expect(metadataSourceLabel("isbndb")).toBe("ISBNdb");
    expect(metadataSourceLabel("phantom_canon")).toBe("Phantom Canon");
    expect(metadataSourceLabel("some_new_source")).toBe("Some new source");
  });

  it("labels other stored keys", () => {
    expect(enumLabel("lent_out")).toBe("Lent out");
    expect(enumLabel("very_good")).toBe("Very good");
    expect(enumLabel("ebook")).toBe("E-book");
    expect(enumLabel("male")).toBe("Male");
  });

  it("labels orders, and copies the way every other list says them", () => {
    expect(orderStatusLabel("in_transit")).toBe("In transit");
    expect(orderStatusLabel("bid")).toBe("Bid placed");
    expect(orderStatusLabel("some_new_status")).toBe("Some new status");
    expect(orderStatusLabel(null)).toBe("");
    expect(acquisitionMethodLabel("in_store_purchase")).toBe("Bought in a shop");
    expect(COPY_FORMAT_LABELS.ebook).toBe(enumLabel("ebook"));
    expect(COPY_CONDITION_LABELS.very_good).toBe(enumLabel("very_good"));
  });

  it("shows the short country name", () => {
    expect(
      countryDisplayName({
        name: "United Kingdom of Great Britain and Northern Ireland",
        alpha2: "GB",
      }),
    ).toBe("United Kingdom");
    expect(
      countryDisplayName({ name: "Argentina, Argentine Republic", alpha2: "AR" }),
    ).toBe("Argentina");
    expect(
      countryDisplayName({ name: "Argentina, Argentine Republic", alpha2: null }),
    ).toBe("Argentina");
    expect(countryDisplayName(null)).toBeNull();
  });

  it("labels values in activity descriptions", () => {
    expect(
      formatEventDescription("work.catalogue_status_changed", {
        oldValue: "on_order",
        newValue: "accessioned",
      }),
    ).toBe("Changed catalogue status from On Order to Accessioned");
    expect(
      formatEventDescription("work.language_changed", { newValue: "de" }),
    ).toBe("Set original language to German");
  });
});
