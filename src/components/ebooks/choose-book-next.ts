/** The eBook whose new book is chosen next, once its page shows it unlinked
 * ("Change the book…", SLN-666): the unlink dialog sets it, the eBook's link
 * controls open "Choose a book" for it. In memory only: a reload forgets it. */
let next: string | null = null;
export const chooseBookNext = {
  set(ebookId: string) { next = ebookId; },
  /** True once, for that eBook */
  take(ebookId: string) {
    if (next !== ebookId) return false;
    next = null;
    return true;
  },
};
