# Plain order words, complete dates and accessible cards

SLN-1122. Order forms now use sentence-case labels and readable language names. The wizard separates the step number and title with a colon. Details offer an Order page, Tracking number, Open book (or the collection's kind), and a sentence-case next status.

Calendar dates retain their day and year across browser time zones. Missing dates say Not set. Every order-card button has a concise accessible name with its title, status and full age words; drag instructions describe the supported keyboard path through the order details. The initial empty state includes a working New order action.

Validation is recorded on SLN-1122 and the pull request. No schema or live catalogue changes.

The rendered narrow-screen check also caught the auction arrow 9.38 px below the adjacent text. Immediate and auction cards now wrap their details below the title, keep the full title visible, and align the arrow to its first line.
