"""Database connection and helper functions for the enrichment pipeline."""

import os
import re
from contextlib import contextmanager
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

_raw_url = os.environ["DATABASE_URL"]
# psycopg2 does not support channel_binding — strip it
DATABASE_URL = re.sub(r"[&?]channel_binding=[^&]*", "", _raw_url)


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


def fetch_all(cur, sql: str, params: tuple = ()) -> list:
    """Execute a SELECT and return all rows."""
    cur.execute(sql, params)
    return cur.fetchall()


def fetch_one(cur, sql: str, params: tuple = ()):
    """Execute a SELECT and return one row or None."""
    cur.execute(sql, params)
    return cur.fetchone()
