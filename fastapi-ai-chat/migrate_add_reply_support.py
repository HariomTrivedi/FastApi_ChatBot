#!/usr/bin/env python3

"""
Migration script to add reply support to chat messages.
Adds reply_to_message_id column to chat_messages table.
"""

import sqlite3
from pathlib import Path

def migrate_database():
    """Add reply_to_message_id column to chat_messages table"""

    # Path to the database
    db_path = Path(__file__).parent / "chatbot.db"

    if not db_path.exists():
        print(f"Database not found at {db_path}")
        return

    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.cursor()

        # Check if column already exists
        cursor.execute("PRAGMA table_info(chat_messages)")
        columns = [col[1] for col in cursor.fetchall()]

        if "reply_to_message_id" not in columns:
            print("Adding reply_to_message_id column to chat_messages table...")

            # Add the new column
            cursor.execute("""
                ALTER TABLE chat_messages
                ADD COLUMN reply_to_message_id INTEGER REFERENCES chat_messages(id)
            """)

            conn.commit()
            print("✅ Migration completed successfully!")
        else:
            print("✅ reply_to_message_id column already exists")

    except Exception as e:
        print(f"❌ Migration failed: {e}")
        conn.rollback()
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    migrate_database()