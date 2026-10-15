import { describe, expect, it } from "vitest";
import { cardEdition } from "@/app/(catalogue)/library/[slug]/card-edition";

const edition = (id: string, added: string) => ({ id, createdAt: new Date(added) });

describe("cardEdition", () => {
  it("takes the earliest added edition, whatever the page's order", () => {
    // The book page lists editions newest publication first
    const editions = [edition("c", "2024-03-01"), edition("a", "2021-05-01"), edition("b", "2022-01-01")];
    expect(cardEdition(editions)?.id).toBe("a");
  });

  it("breaks a tie by id, as the card's query does", () => {
    const editions = [edition("9f", "2021-05-01T10:00:00Z"), edition("1a", "2021-05-01T10:00:00Z")];
    expect(cardEdition(editions)?.id).toBe("1a");
  });

  it("has none for a book with no editions", () => {
    expect(cardEdition([])).toBeUndefined();
  });
});
