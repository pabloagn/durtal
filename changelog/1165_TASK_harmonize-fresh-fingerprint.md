# Reuse unchanged Harmonize data after a fresh database check

SLN-1508. Every scan still reads one current database snapshot and hashes its complete input. When the fingerprint is unchanged, the server reuses its one retained dataset instead of transferring and decoding the same catalogue again. A change from any writer is detected without relying on application cache invalidation. Nothing expires by a timer, and Scan library still recalculates findings and decisions.

Validation includes real PostgreSQL checks for unchanged input and direct database updates/deletes, the existing Harmonize rules and merge tests, and production timing on a 5,000-book fixture. No migration, live data write or infrastructure change.
