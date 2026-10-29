# Explain unavailable e-book files beside the cover

SLN-1038: when no readable file remains, the e-book page explains whether the file is damaged or missing from storage and offers its replacement beside the cover. It chooses the preferred unavailable file when present. Existing DRM explanations, excluded e-books and books with a readable alternative keep their current behaviour.

No schema or catalogue changes. Native validation covers quarantined, missing and DRM cases at desktop, phone and narrow-phone widths.
