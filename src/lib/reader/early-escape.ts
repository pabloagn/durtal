/** Where the page's inline script keeps an Escape pressed before the reader's code runs */
export const EARLY_ESCAPE_GLOBAL = "__durtalEarlyEscape";

/**
 * The page's inline script (SLN-811): while "Opening the book" shows and the
 * reader's own code is still on its way, it notes an Escape so the press is
 * not lost. The reader takes it with takeEarlyEscape() once it listens.
 */
export function earlyEscapeScript(): string {
  return `(function(){
var w=window,s={pressed:false};
function key(e){if(e.key==="Escape"&&!e.metaKey&&!e.ctrlKey&&!e.altKey)s.pressed=true;}
s.take=function(){document.removeEventListener("keydown",key,true);var pressed=s.pressed;s.pressed=false;return pressed;};
w.${EARLY_ESCAPE_GLOBAL}=s;
document.addEventListener("keydown",key,true);
})()`;
}

/** Whether Escape was pressed before the reader listened; the script stops listening */
export function takeEarlyEscape(): boolean {
  const holder = window as unknown as Record<string, { take?: () => boolean } | undefined>;
  const early = holder[EARLY_ESCAPE_GLOBAL];
  delete holder[EARLY_ESCAPE_GLOBAL];
  return !!early?.take?.();
}
