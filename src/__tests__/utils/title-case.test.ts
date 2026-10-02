import { describe, expect, it } from "vitest";
import { capitalizeTitle } from "@/lib/utils/title-case";

describe("English title case", () => {
  it.each([
    ["the master and margarita", "The Master and Margarita"],
    ["a confederacy of dunces", "A Confederacy of Dunces"],
    ["journey to the end of the night", "Journey to the End of the Night"],
    ["far from the madding crowd", "Far from the Madding Crowd"],
    ["the man without qualities", "The Man Without Qualities"],
    ["one flew over the cuckoo's nest", "One Flew Over the Cuckoo's Nest"],
    ["a good man is hard to find", "A Good Man Is Hard to Find"],
    ["i know this much is true", "I Know This Much Is True"],
    ["we need to talk about kevin", "We Need to Talk About Kevin"],
    ["the world as will and representation", "The World as Will and Representation"],
    ["of mice and men", "Of Mice and Men"],
    ["where the wild things are", "Where the Wild Things Are"],
    ["the trouble With Being Born", "The Trouble with Being Born"],
  ])("%s", (input, expected) => {
    expect(capitalizeTitle(input)).toBe(expected);
  });

  it("capitalizes the last word, also when it is small", () => {
    expect(capitalizeTitle("The World Goes on")).toBe("The World Goes On");
    expect(capitalizeTitle("what it's all about")).toBe("What It's All About");
  });

  it("starts each subtitle and second title with a capital", () => {
    expect(capitalizeTitle("the stranger: a novel")).toBe("The Stranger: A Novel");
    expect(capitalizeTitle("the lord of the rings: the fellowship of the ring")).toBe(
      "The Lord of the Rings: The Fellowship of the Ring",
    );
    expect(capitalizeTitle("If This is a Man / The Truce")).toBe(
      "If This Is a Man / The Truce",
    );
    expect(capitalizeTitle("Notes from Underground & The Double")).toBe(
      "Notes from Underground & The Double",
    );
    expect(capitalizeTitle("Maldoror & the Complete Works of the Comte de Lautréamont")).toBe(
      "Maldoror & the Complete Works of the Comte de Lautréamont",
    );
    expect(capitalizeTitle("spring—and all")).toBe("Spring—And All");
    expect(capitalizeTitle("who's afraid of virginia woolf? a play")).toBe(
      "Who's Afraid of Virginia Woolf? A Play",
    );
  });

  it("keeps a subtitle that has no colon", () => {
    expect(capitalizeTitle("Infinite Jest A Novel")).toBe("Infinite Jest A Novel");
    expect(capitalizeTitle("Perfume The Story of a Murderer")).toBe(
      "Perfume The Story of a Murderer",
    );
    expect(capitalizeTitle("Gone With The Wind")).toBe("Gone with the Wind");
    expect(capitalizeTitle("The Rings Of Saturn")).toBe("The Rings of Saturn");
  });

  it("starts a second title after 'or'", () => {
    expect(capitalizeTitle("Justine, Or the Misfortunes of Virtue")).toBe(
      "Justine, or The Misfortunes of Virtue",
    );
    expect(capitalizeTitle("Heliogabalus: Or, The Crowned Anarchist")).toBe(
      "Heliogabalus: Or, The Crowned Anarchist",
    );
    expect(capitalizeTitle("Ada Or Ardor")).toBe("Ada or Ardor");
  });

  it("handles compounds, numerals, initials and punctuation", () => {
    expect(capitalizeTitle("Auto-da-Fé")).toBe("Auto-da-Fé");
    expect(capitalizeTitle("Nineteen Seventy-four")).toBe("Nineteen Seventy-Four");
    expect(capitalizeTitle("slaughterhouse-five")).toBe("Slaughterhouse-Five");
    expect(capitalizeTitle("an out-of-print book")).toBe("An Out-of-Print Book");
    expect(capitalizeTitle("henry iv, part ii")).toBe("Henry IV, Part II");
    expect(capitalizeTitle("'salem's lot")).toBe("'Salem's Lot");
    expect(capitalizeTitle("cyclonopedia: complicity with anonymous materials (anomaly)")).toBe(
      "Cyclonopedia: Complicity with Anonymous Materials (Anomaly)",
    );
    expect(capitalizeTitle("tales from 1,001 nights")).toBe("Tales from 1,001 Nights");
  });

  it("keeps capitals typed on purpose", () => {
    expect(capitalizeTitle("H.P. Lovecraft: against the world, against life")).toBe(
      "H.P. Lovecraft: Against the World, Against Life",
    );
    expect(capitalizeTitle("blood meridian by cormac McCarthy")).toBe(
      "Blood Meridian by Cormac McCarthy",
    );
    expect(capitalizeTitle("1Q84")).toBe("1Q84");
    expect(capitalizeTitle("the USA trilogy")).toBe("The USA Trilogy");
    expect(capitalizeTitle("the da vinci code")).toBe("The Da Vinci Code");
    expect(capitalizeTitle("simone de beauvoir: a biography")).toBe(
      "Simone de Beauvoir: A Biography",
    );
  });

  it("fixes a title in capitals", () => {
    expect(capitalizeTitle("THE BROTHERS KARAMAZOV")).toBe("The Brothers Karamazov");
    expect(capitalizeTitle("H.P. LOVECRAFT: TALES, VOL. II")).toBe(
      "H.P. Lovecraft: Tales, Vol. II",
    );
  });

  it("cleans up spaces", () => {
    expect(capitalizeTitle("  the   trial ")).toBe("The Trial");
    expect(capitalizeTitle("   ")).toBe("");
  });

  it("is stable when pressed again", () => {
    const once = capitalizeTitle("the turn of the screw");
    expect(capitalizeTitle(once)).toBe(once);
  });
});

describe("other languages", () => {
  it("leaves correct sentence case alone", () => {
    expect(capitalizeTitle("Abaddón el exterminador", "es")).toBe("Abaddón el exterminador");
    expect(capitalizeTitle("La piel del lobo", "es")).toBe("La piel del lobo");
    expect(capitalizeTitle("Todo modo", "it")).toBe("Todo modo");
    expect(capitalizeTitle("Viaje a Ixtlán")).toBe("Viaje a Ixtlán");
  });

  it("puts articles and prepositions in small letters", () => {
    expect(capitalizeTitle("Monsieur De Phocas", "fr")).toBe("Monsieur de Phocas");
    expect(capitalizeTitle("cien años De soledad", "es")).toBe("Cien años de soledad");
  });

  it("fixes a title in capitals", () => {
    expect(capitalizeTitle("LAS TIERRAS ARRASADAS")).toBe("Las tierras arrasadas");
    expect(capitalizeTitle("L'ÉTRANGER", "fr")).toBe("L'Étranger");
  });

  it("follows the words when the language field is wrong", () => {
    expect(capitalizeTitle("the turn of the screw", "ja")).toBe("The Turn of the Screw");
    expect(capitalizeTitle("The Great Gatsby", "fr")).toBe("The Great Gatsby");
    expect(capitalizeTitle("fragments de Lichtenberg", "fr")).toBe("Fragments de Lichtenberg");
  });
});
