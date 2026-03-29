"""Database connection and helper functions."""

import psycopg2
import psycopg2.extras
from contextlib import contextmanager

from scripts.ingest.config import DATABASE_URL


def get_connection():
    """Create a new database connection."""
    return psycopg2.connect(DATABASE_URL)


@contextmanager
def transaction():
    """Context manager that yields a cursor inside a transaction.

    Commits on clean exit, rolls back on exception.
    """
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_returning_id(
    cur,
    table: str,
    columns: list[str],
    values: tuple,
    conflict_column: str,
    *,
    update_on_conflict: bool = False,
    update_columns: list[str] | None = None,
) -> str:
    """Insert a row, return the id (uuid). On conflict, either DO NOTHING or UPDATE.

    Returns the id of the existing or newly inserted row.
    """
    placeholders = ", ".join(["%s"] * len(values))
    col_list = ", ".join(columns)

    if update_on_conflict and update_columns:
        set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_columns)
        sql = f"""
            INSERT INTO {table} ({col_list})
            VALUES ({placeholders})
            ON CONFLICT ({conflict_column}) DO UPDATE SET {set_clause}
            RETURNING id
        """
    else:
        sql = f"""
            INSERT INTO {table} ({col_list})
            VALUES ({placeholders})
            ON CONFLICT ({conflict_column}) DO NOTHING
            RETURNING id
        """

    cur.execute(sql, values)
    row = cur.fetchone()
    if row:
        return row[0]

    # Row already existed — fetch its id
    cur.execute(f"SELECT id FROM {table} WHERE {conflict_column} = %s", (values[columns.index(conflict_column)],))
    row = cur.fetchone()
    return row[0] if row else None


def lookup_id(cur, table: str, column: str, value) -> str | None:
    """Look up a single row's id by a column value."""
    if value is None:
        return None
    cur.execute(f"SELECT id FROM {table} WHERE {column} = %s", (value,))
    row = cur.fetchone()
    return row[0] if row else None


def lookup_id_ilike(cur, table: str, column: str, value: str) -> str | None:
    """Case-insensitive lookup of a row's id."""
    if not value:
        return None
    cur.execute(f"SELECT id FROM {table} WHERE LOWER({column}) = LOWER(%s)", (value.strip(),))
    row = cur.fetchone()
    return row[0] if row else None


def bulk_load_lookup(cur, table: str, key_column: str = "name") -> dict[str, str]:
    """Load an entire table as {key_column_value: id} dict."""
    cur.execute(f"SELECT {key_column}, id FROM {table}")
    return {row[0]: row[1] for row in cur.fetchall()}


def insert_junction(cur, table: str, col_a: str, col_b: str, id_a: str, id_b: str):
    """Insert into a junction table, ignoring duplicates."""
    cur.execute(
        f"INSERT INTO {table} ({col_a}, {col_b}) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (id_a, id_b),
    )
