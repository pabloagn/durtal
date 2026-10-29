# Shared field sizes and phone keyboards

SLN-1222: list searches, sort menus, page-size/page-number fields, catalogue and taxonomy pickers, category filters and series positions use the shared field sizing: 14px for a fine pointer and 16px for a coarse pointer. Textareas share the input fill. The remaining native date, colour and filter fields have explicit touch sizing.

Search fields request the search keyboard without autocorrection, automatic capitals, spelling replacement or a native WebKit clear decoration. ISBN and identifier fields disable text correction; ISBN-13 uses a numeric keyboard and ISBN-10 allows a capital X.

Regression coverage checks sort navigation, page-size focus, search attributes and a source-wide guard for small native text fields without touch sizing. Native browser checks are recorded privately with the release evidence. Harmonize’s separately tracked fields are unchanged.
