import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractMainText, mainTextExtractor } from "@/lib/enrichment/extract";

// The evidence store's main-text extractor (SLN-468): Readability on linkedom

const REVIEW = `<!doctype html><html lang="fr"><head><title>Une critique | La Revue</title>
<link rel="canonical" href="/critique/une-critique">
<meta property="article:published_time" content="2024-05-02T10:00:00Z"><meta name="author" content="Jeanne Martin"></head>
<body><nav><a href="/">Accueil</a> <a href="/livres">Livres</a></nav><script>var tracker = 1;</script>
<article><h1>Une critique</h1>
<p>Le roman s'ouvre sur une scène   d'une rare violence, et la prose,
longue et sinueuse, ne relâche jamais son emprise sur le lecteur.</p>
<p>On y retrouve l'obsession de l'auteur pour la mémoire, la ruine et la <em>lente</em> décomposition des villes de province, racontée avec une ironie noire.</p>
<blockquote><p>« La ville était une plaie ouverte », écrit-il.</p></blockquote>
<p>Un livre exigeant, mais qui récompense la patience de qui accepte de s'y perdre pendant des heures entières, page après page.</p></article>
<footer>© La Revue, tous droits réservés</footer></body></html>`;

describe("extractMainText", () => {
  it("keeps the article's paragraphs, joined by a blank line, and leaves out the menu, scripts and footer", () => {
    const page = extractMainText(REVIEW, "https://revue.example/critique/une-critique?utm_source=x")!;
    expect(page.text.split("\n\n")).toEqual([
      "Le roman s'ouvre sur une scène d'une rare violence, et la prose, longue et sinueuse, ne relâche jamais son emprise sur le lecteur.",
      "On y retrouve l'obsession de l'auteur pour la mémoire, la ruine et la lente décomposition des villes de province, racontée avec une ironie noire.",
      "« La ville était une plaie ouverte », écrit-il.",
      "Un livre exigeant, mais qui récompense la patience de qui accepte de s'y perdre pendant des heures entières, page après page.",
    ]);
    expect(page.text).not.toMatch(/Accueil|tracker|droits réservés/);
  });

  it("reads the title, byline, date and language, and resolves the canonical URL against the page", () => {
    expect(extractMainText(REVIEW, "https://revue.example/critique/une-critique?utm_source=x")).toMatchObject({
      title: "Une critique | La Revue",
      byline: "Jeanne Martin",
      publishedOn: "2024-05-02T10:00:00Z",
      language: "fr",
      canonicalUrl: "https://revue.example/critique/une-critique",
    });
  });

  it("reads a page with no <html> or no <body> element as a browser does", () => {
    expect(extractMainText("<p>Café au lait.</p>", "https://x.example/")?.text).toBe("Café au lait.");
    expect(extractMainText("<html lang=de><head><title>Ohne Body</title></head><p>Kein Body hier.</p></html>", "https://x.example/")).toMatchObject({
      text: "Kein Body hier.",
      title: "Ohne Body",
      language: "de",
    });
  });

  it("keeps a page's title in its head when the page leaves out its <head> or <html> tag", () => {
    const article = `<article><h1>Ohne Kopf</h1><p>${"Ein Absatz mit genug Prosa, damit er zählt, und noch ein paar Wörter. ".repeat(6)}</p></article>`;
    for (const html of [
      `<!doctype html><html lang=de><title>Ohne Kopf</title><link rel=canonical href=/k>${article}</html>`,
      `<!doctype html><head><title>Ohne Kopf</title><link rel=canonical href=/k></head><body>${article}</body>`,
      `<!doctype html><meta charset=utf-8><title>Ohne Kopf</title><link rel=canonical href=/k>${article}`,
    ]) {
      const page = extractMainText(html, "https://x.example/a")!;
      expect(page).toMatchObject({ title: "Ohne Kopf", canonicalUrl: "https://x.example/k" });
      // The heading that repeats the title is Readability's to drop, as on a page with every tag
      expect(page.text).not.toMatch(/^Ohne Kopf/);
    }
  });

  it("reads attribute names in any case, as a browser does", () => {
    const prose = (n: number) => `<P>Paragraph ${n} of the review, ${"long enough to count as prose for the extractor, ".repeat(6)}</P>`;
    const comments = [7, 8].map((n) => `<P>Comment ${n}: ${"a reader's long comment about the review, ".repeat(8)}</P>`).join("");
    const html = `<!DOCTYPE HTML><HTML LANG="en"><HEAD><TITLE>Review</TITLE><LINK REL="canonical" HREF="/r"></HEAD><BODY><DIV CLASS="article">${[1, 2, 3].map(prose).join("")}</DIV><DIV CLASS="comments">${comments}</DIV></BODY></HTML>`;
    const page = extractMainText(html, "https://x.example/a")!;
    expect(page).toMatchObject({ language: "en", canonicalUrl: "https://x.example/r" });
    expect(page.text).not.toMatch(/Comment/);
  });

  it("gives nothing for an empty page, and no canonical URL for one it cannot read", () => {
    expect(extractMainText("", "https://x.example/")).toBeNull();
    expect(extractMainText("<html><body></body></html>", "https://x.example/")).toBeNull();
    const page = extractMainText("<html><head><link rel=canonical href='http://[bad'></head><body><p>Short text.</p></body></html>", "https://x.example/");
    expect(page).toMatchObject({ text: "Short text.", canonicalUrl: null });
  });

  it("names itself in each stored page: Readability and linkedom, at their pinned versions", () => {
    const { dependencies } = JSON.parse(readFileSync("package.json", "utf8"));
    expect(mainTextExtractor).toMatchObject({
      name: "readability",
      version: `@mozilla/readability ${dependencies["@mozilla/readability"]}, linkedom ${dependencies.linkedom}`,
    });
  });
});
