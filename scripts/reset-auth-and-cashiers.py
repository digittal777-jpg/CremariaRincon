from __future__ import annotations

import datetime
import shutil
import sqlite3
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    db_path = root / "data" / "cremaria-rincon.sqlite"
    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = root / "data" / f"cremaria-rincon.backup-{timestamp}.sqlite"

    shutil.copy2(db_path, backup_path)

    with sqlite3.connect(db_path) as connection:
        cursor = connection.cursor()
        cursor.execute("DELETE FROM cashiers")
        cursor.execute("DELETE FROM sqlite_sequence WHERE name = 'cashiers'")
        cursor.execute("DELETE FROM app_settings WHERE key = 'admin.password'")
        connection.commit()

        cashiers_count = cursor.execute("SELECT COUNT(*) FROM cashiers").fetchone()[0]
        admin_password_rows = cursor.execute(
            "SELECT COUNT(*) FROM app_settings WHERE key = 'admin.password'"
        ).fetchone()[0]

    print(f"backup={backup_path}")
    print(f"cashiers_count={cashiers_count}")
    print(f"admin_password_rows={admin_password_rows}")


if __name__ == "__main__":
    main()
