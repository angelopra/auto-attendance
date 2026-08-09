import os
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./database/kendo.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Columns added after the first release. `create_all` only creates missing
# tables, so existing databases need the new columns bolted on by hand.
ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("group_photos", "date_edited_at", "DATETIME"),
]


def apply_pending_migrations() -> None:
    """Add columns introduced after a database was first created (SQLite-safe)."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, column, column_type in ADDED_COLUMNS:
            if table not in existing_tables:
                continue
            columns = {c["name"] for c in inspector.get_columns(table)}
            if column in columns:
                continue
            conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {column_type}'))
            print(f"Migration: added {table}.{column}")
