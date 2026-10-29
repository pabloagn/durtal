/*
 * A file locked with DRM, in plain words (SLN-685): the e-book page and the
 * reader say what locks it and what to do, never the scheme's code name.
 */

const LOCKS: Record<string, string> = {
  "adobe-adept": "Adobe DRM",
  kindle: "Kindle DRM",
  "readium-lcp": "Readium LCP",
  "apple-fairplay": "Apple FairPlay",
  "pdf-password": "a password",
};

/** What locks a file: "Adobe DRM", "a password", or "DRM" for a scheme not named */
export function lockName(drm: string): string {
  return LOCKS[drm] ?? "DRM";
}

/** Why a locked file cannot be read, and what to do instead */
export function lockedFileMessage(drm: string): string {
  return drm === "pdf-password"
    ? "This file is locked with a password; Durtal can’t open it. Replace it with a copy that has no password."
    : `This file is locked with ${lockName(drm)}; Durtal can’t open it. Replace it with a DRM-free copy.`;
}
