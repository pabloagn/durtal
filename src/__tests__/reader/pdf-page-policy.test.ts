import { describe, expect, it } from "vitest";
import { pdfImageCoverage } from "@/lib/reader/engines/foliate/pdf-image-coverage";
import { pdfPageThemeMatrix } from "@/lib/reader/engines/foliate/pdf-page-theme";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import { themeColours } from "@/lib/reader/presentation/themes";
const ops = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, clip: 5 };
describe("PDF page policy source contracts", () => {
  it("classifies actual transformed image coverage conservatively", () => {
    expect(pdfImageCoverage([3,4], [[600,0,0,800,0,0],[]],ops,[0,0,600,800])).toEqual([1]);
    expect(pdfImageCoverage([3,5,4], [[600,0,0,800,0,0],[],[]],ops,[0,0,600,800])).toEqual([]);
    expect(pdfImageCoverage([3,4], [[600,1,0,800,0,0],[]],ops,[0,0,600,800])).toEqual([]);
  });
  it("maps black/white raster endpoints to actual themed ink/paper", () => {
    const p = PRESENTATION_DEFAULTS.desktop, colors = themeColours(p), matrix = pdfPageThemeMatrix(p).split(" ").map(Number);
    expect(matrix).toHaveLength(20);
    for (let i=0;i<3;i++) {
      expect(matrix[i*5+4]).toBeCloseTo(parseInt(colors.text.slice(1+i*2,3+i*2),16)/255);
      expect(matrix.slice(i*5,i*5+3).reduce((a,b)=>a+b,0)+matrix[i*5+4]).toBeCloseTo(parseInt(colors.background.slice(1+i*2,3+i*2),16)/255);
    }
  });
});
