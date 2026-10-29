# Menu keyboard navigation and surface ownership

SLN-1300: dropdown items use programmatic focus, including unavailable actions. Tab closes the menu and restores its trigger; arrow keys, Home/End and label typeahead move focus without activating commands. Keyboard focus receives an inset outline.

Dropdowns, mark cards and collection icon pickers now join the shared Escape stack. A newer surface keeps ownership of Escape, and global single-key shortcuts see the open surface. Menu-to-dialog focus restoration keeps the original trigger. A mark card stays closed when Escape returns focus from its date input.

Tests cover unavailable items, typeahead, Tab, nested Escape ownership, menu-to-dialog focus, mark-card focus restoration and collection-picker ownership. No schema or catalogue changes.
