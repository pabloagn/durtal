// Durtal (SLN-660, VENDORED.md 26): a page change that has to load first
// keeps the page on screen until the next one is ready, then slides or fades
// it away, so no frame is blank. The View Transitions API takes the snapshot.
// Chromium and Firefox run no animation frames during a transition's update
// callback, and loading a page needs them, so there the snapshot is taken
// with an empty update and held by an endless animation while the page
// changes under it, on the live new layer. WebKit does run them, but its new
// layer keeps what it was when the update ended, so there the page changes
// inside the update. Which one this is, is found on the first hold.

const NAME = 'foliate-hold'
const HOLD = 'foliate-hold'
// A page that takes longer than this shows as it is
const HOLD_LIMIT_MS = 3000
// Frames a page changed inside the update gets to paint in
const PAINT_FRAMES = 3
const SLIDE_EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
const CLASSES = [HOLD, `${HOLD}-whole`, `${HOLD}-book`, `${HOLD}-out`, `${HOLD}-over`]

let active = null
const matchElement = () => typeof CSS !== 'undefined' && CSS.supports?.('view-transition-name', 'match-element') === true
// Whether animation frames run inside an update callback (WebKit)
let framesInUpdate = null

const frameWithin = ms => new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms)
    requestAnimationFrame(() => { clearTimeout(timer); resolve(true) })
})
// How long to wait for a frame inside the first update: three of this
// page's frames, measured just before, so a busy page is not taken for one
// that runs no frames there; at most half a second
const probeWait = () => new Promise(resolve => {
    const start = performance.now()
    const timer = setTimeout(() => resolve(500), 200)
    requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer)
        resolve(Math.min(500, Math.max(100, 1.5 * (performance.now() - start))))
    }))
})
// Whether `promise` settled within `ms`
const settlesWithin = (promise, ms) => {
    let timer
    return Promise.race([
        promise.then(() => true, () => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), ms) }),
    ]).finally(() => clearTimeout(timer))
}

const injectStyles = () => {
    const id = 'foliate-hold-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
    html.${HOLD}::view-transition {
        pointer-events: none;
    }
    html.${HOLD}::view-transition-group(*) {
        animation: none;
    }
    html.${HOLD}::view-transition-old(*),
    html.${HOLD}::view-transition-new(*) {
        animation: none;
        mix-blend-mode: normal;
    }
    /* The page as it was stays on top until it is let go */
    html.${HOLD}-whole::view-transition-old(root),
    html.${HOLD}-book::view-transition-old(${NAME}) {
        z-index: 1;
        animation: foliate-hold 1s linear infinite;
    }
    html.${HOLD}-book::view-transition-old(${NAME}),
    html.${HOLD}-book::view-transition-new(${NAME}) {
        background: var(--foliate-hold-bg, Canvas);
    }
    html.${HOLD}-out::view-transition-old(${NAME}),
    html.${HOLD}-over::view-transition-new(${NAME}),
    html.${HOLD}-whole.${HOLD}-out::view-transition-old(root),
    html.${HOLD}-whole.${HOLD}-over::view-transition-new(root) {
        box-shadow: 0 0 24px rgba(0, 0, 0, 0.35);
    }
    html.${HOLD}-over::view-transition-new(${NAME}),
    html.${HOLD}-whole.${HOLD}-over::view-transition-new(root) {
        z-index: 2;
    }
    /* Only the book is held, or slides: the reader's bars and controls over
       it keep their own layers above it */
    html.${HOLD}-book [data-reader-chrome],
    html.${HOLD}-whole [data-reader-chrome] {
        view-transition-name: match-element;
    }
    @keyframes foliate-hold { to { opacity: 1; } }
    `
    document.head.append(style)
}

// The element held for the book: the outermost shadow host, as the paginator's
// own turns do, since a name inside a shadow tree is scoped away from the
// document's transition
const bookElement = host => {
    let element = host
    while (element.getRootNode() instanceof ShadowRoot) element = element.getRootNode().host
    return element.closest('[data-view-transition-root]') ?? element
}

/**
 * Runs `change` under a held snapshot of the book, then fades it away, or
 * slides it for a turn with `turn: 'slide'`, in its direction. `change(held)`
 * is told whether the snapshot is up, and resolves `false` when nothing
 * changed. Without View Transitions, or with one already running, it just
 * runs `change(false)`.
 * @param {HTMLElement} host
 * @param {(held: boolean) => Promise<unknown>} change
 * @param {{ turn?: 'slide' | 'fade' | null, forward?: boolean, rtl?: boolean,
 *   duration?: number, background?: string }} [options]
 */
export async function changeUnderHold(host, change, options = {}) {
    const { forward = true, rtl = false, duration = 0, background } = options
    if (active || typeof document.startViewTransition !== 'function'
        || document.visibilityState === 'hidden') return change(false)
    const html = document.documentElement
    // Chromium leaves the book out of a whole-screen snapshot for a frame or
    // two, and WebKit leaves a book snapshot of its own blank in the new
    // layer, so Chromium and Firefox hold the book and WebKit the whole
    // screen. Until it is known which this is, the book is held.
    const whole = framesInUpdate === true
    const named = whole ? null : bookElement(host)
    if (named?.style.viewTransitionName) return change(false)
    // WebKit holds the whole screen, with the reader's controls on layers of
    // their own, so a turn slides the page there too (SLN-660)
    // A whole-screen hold slides only where the reader's bars can keep their
    // own layers (match-element): an older Safari would slide them too
    let slide = options.turn === 'slide' && (!whole || matchElement())
    injectStyles()
    const image = whole ? '(root)' : `(${NAME})`
    const OLD = `::view-transition-old${image}`
    const NEW = `::view-transition-new${image}`
    html.classList.remove(...CLASSES)
    html.classList.add(HOLD, whole ? `${HOLD}-whole` : `${HOLD}-book`)
    if (background) html.style.setProperty('--foliate-hold-bg', background)
    if (named) named.style.viewTransitionName = NAME
    const self = {}
    active = self
    const cleanup = () => {
        if (active === self) active = null
        html.classList.remove(...CLASSES)
        html.style.removeProperty('--foliate-hold-bg')
        if (named?.style.viewTransitionName === NAME) named.style.removeProperty('view-transition-name')
    }
    const wait = framesInUpdate === null ? await probeWait() : 0
    let changing = null
    const start = () => (changing ??= Promise.resolve().then(() => change(true)))
    let settled = true
    let transition
    try {
        transition = document.startViewTransition(async () => {
            framesInUpdate ??= await frameWithin(wait)
            if (!framesInUpdate) return
            // The first hold in WebKit named the book, whose new layer would
            // stay blank: the page as it was stays held, and the new one is
            // taken with the rest of the screen, then the old one fades
            if (named) {
                named.style.removeProperty('view-transition-name')
                slide = false
            }
            settled = await settlesWithin(start(), HOLD_LIMIT_MS)
            // Let the new page paint before WebKit takes it as the new layer
            for (let i = 0; settled && i < PAINT_FRAMES; i++) await frameWithin(100)
        })
    } catch {
        cleanup()
        return change(false)
    }
    let held = true
    try {
        await transition.ready
    } catch {
        held = false
    }
    if (!held) {
        cleanup()
        return changing ?? change(false)
    }
    if (!changing) settled = await settlesWithin(start(), HOLD_LIMIT_MS)
    const timedOut = !settled
    try {
        const moved = !timedOut && await changing.then(result => result !== false, () => false)
        const holds = html.getAnimations({ subtree: true })
            .filter(animation => animation.effect?.pseudoElement === OLD)
        if (moved && duration > 0) {
            const timing = { duration, easing: SLIDE_EASING, fill: 'forwards' }
            const away = `translateX(${rtl ? 100 : -100}%)`
            if (!slide)
                html.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: 'ease-out', pseudoElement: OLD })
            else if (forward) {
                html.classList.add(`${HOLD}-out`)
                html.animate([{ transform: 'none' }, { transform: away }], { ...timing, pseudoElement: OLD })
            } else {
                html.classList.add(`${HOLD}-over`)
                html.animate([{ transform: away }, { transform: 'none' }], { ...timing, pseudoElement: NEW })
            }
        }
        for (const animation of holds) animation.cancel()
        await transition.finished.catch(() => {})
    } finally {
        cleanup()
    }
    return changing
}
