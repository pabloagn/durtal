import { describe, expect, it } from "vitest";
import { cityFromAddress, streetFromAddress } from "@/lib/utils/address";

describe("cityFromAddress", () => {
  it("reads the city before the country, without the postal code", () => {
    expect(cityFromAddress("Spui 14-16, 1012 XA Amsterdam, Netherlands")).toBe("Amsterdam");
    expect(cityFromAddress("12 Rue de l'Odéon, 75006 Paris, France")).toBe("Paris");
    expect(cityFromAddress("Oranienstraße 25, 10999 Berlin, Germany")).toBe("Berlin");
    expect(cityFromAddress("Rua Garrett 73, Lisboa 1200-195, Portugal")).toBe("Lisboa");
    expect(cityFromAddress("Charing Cross Road, London WC2H 0EP, UK")).toBe("London");
  });

  it("gives null when the part before the country is not a plain name", () => {
    expect(cityFromAddress("100 Main St, Brooklyn, NY 11201, USA")).toBeNull();
    expect(cityFromAddress("Netherlands")).toBeNull();
    expect(cityFromAddress("")).toBeNull();
    expect(cityFromAddress(null)).toBeNull();
  });
});

describe("streetFromAddress", () => {
  it("reads the street without its number", () => {
    expect(streetFromAddress("Spui 14-16, 1012 XA Amsterdam, Netherlands")).toBe("Spui");
    expect(streetFromAddress("Oude Hoogstraat 14-18, 1012 CE Amsterdam, Netherlands")).toBe("Oude Hoogstraat");
    expect(streetFromAddress("Sloterkade 166C, 1059 EB Amsterdam, Netherlands")).toBe("Sloterkade");
    expect(streetFromAddress("100 Main St, Brooklyn, NY 11201, USA")).toBe("Main St");
  });

  it("gives null for an address with no street part", () => {
    expect(streetFromAddress("Amsterdam, Netherlands")).toBeNull();
    expect(streetFromAddress(null)).toBeNull();
  });
});
