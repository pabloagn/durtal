# Quick progress controls keep the promised unit

SLN-1394 and SLN-1444. One helper chooses the quick-step unit, label and entered value. A typed percent step writes the resulting percent explicitly; a touch step follows the currently selected Page, Percent or Time segment rather than the reading's default unit. Relative page and minute input retains its existing meaning.

Regression coverage submits the percent dialog with mouse and touch, switches touch from Percent to Page, and checks parsing and save payloads for all three units, including a fractional percent and the 100% limit. No schema or live data changes.
