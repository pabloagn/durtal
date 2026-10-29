# Toast actions remain understandable and reachable

SLN-1151. Toast announcements now include the action label and the notifications shortcut, which is also listed in both shortcut views. Undo helpers announce successful restoration and preserve refusal messages. Esc leaves the stack for the prior control, falling back to the page heading.

Touch toasts expand and their action buttons have actual 44px targets. Icons align to the first text line. Action toasts without a lifetime receive the same ten seconds as other actions; Sonner holds them while focused. The reader's initial tracking Undo now shares that real toast lifetime rather than an independent timer. Repeated messages restart their full lifetime, copied URLs are not read aloud, and review errors remain until dismissed.

Validation is recorded on the ticket and pull request. No migration or live catalogue changes.

A small versioned patch to Sonner 2.0.7 makes ordinary keyboard focus pause its timers. Both module formats are patched; dependency versions are unchanged. The Docker dependency stage receives the patch manifest and files.
