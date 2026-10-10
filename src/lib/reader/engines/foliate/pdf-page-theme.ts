import type { ReaderPresentation } from "@/lib/validations/reader-preferences";
import { themeColours } from "../../presentation/themes";
const channels = (hex: string) => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255);
/** White maps to themed paper, black to themed ink. No geometry or text changes. */
export function pdfPageThemeMatrix(p: ReaderPresentation): string {
  const theme = themeColours(p); const paper = channels(theme.background), ink = channels(theme.text);
  return [...ink.flatMap((value, i) => [.2126,.7152,.0722].map(l => (paper[i]-value)*l).concat([0,value])), 0,0,0,1,0].join(" ");
}
export function applyPdfPageTheme(doc: Document, p: ReaderPresentation) {
  const canvas = doc.querySelector<HTMLElement>("#canvas"); if (!canvas) return;
  let svg = doc.querySelector<SVGSVGElement>("svg[data-durtal-pdf-theme]");
  if (!svg) {
    const ns = "http://www.w3.org/2000/svg"; svg = doc.createElementNS(ns,"svg"); svg.setAttribute("data-durtal-pdf-theme",""); svg.setAttribute("aria-hidden","true"); svg.style.cssText="position:absolute;width:0;height:0;pointer-events:none";
    const filter = doc.createElementNS(ns,"filter"); filter.id="durtal-pdf-page-theme"; filter.setAttribute("color-interpolation-filters","sRGB");
    const matrix = doc.createElementNS(ns,"feColorMatrix"); matrix.setAttribute("type","matrix"); filter.append(matrix); svg.append(filter); doc.body.append(svg);
  }
  svg.querySelector("feColorMatrix")!.setAttribute("values",pdfPageThemeMatrix(p));
  canvas.style.filter = p.pdfThemePages ? "url(#durtal-pdf-page-theme)" : `brightness(${p.brightness/100}) sepia(${.4*p.warmth/100})`;
  doc.documentElement.style.backgroundColor = p.pdfThemePages ? themeColours(p).background : "#ffffff";
}
