/** The eBook whose new book is chosen next, once its page shows it unlinked
 * ("Change the book…", SLN-666), and the book to start on ("Link it back",
 * SLN-684): the unlink dialog sets it, the eBook's link controls open
 * "Choose a book" for it. In memory only: a reload forgets it. */
let next: { ebookId: string; workId: string | null } | null = null;
export const chooseBookNext = {
  set(ebookId: string, workId: string | null = null) { next = { ebookId, workId }; },
  /** Once, for that eBook: the book to start on, or null to search; false when none is waiting */
  take(ebookId: string): { workId: string | null } | false {
    if (next?.ebookId !== ebookId) return false;
    const { workId } = next;
    next = null;
    return { workId };
  },
};
