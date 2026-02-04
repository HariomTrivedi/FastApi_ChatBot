"""
Migration script to add file/image sharing fields to ChatMessage table.
Run this script once to update your existing database.
"""
import sqlite3
from pathlib import Path
from app.core.config import settings

def migrate_database():
    """Add new columns to chat_messages table if they don't exist"""
    # Extract database path from SQLite URL
    db_url = settings.database_url
    if db_url.startswith("sqlite:///"):
        db_path = db_url.replace("sqlite:///", "")
        if not Path(db_path).is_absolute():
            db_path = Path(__file__).parent / db_path
    else:
        print("This migration script only supports SQLite databases.")
        return
    
    print(f"Connecting to database: {db_path}")
    
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    try:
        # Check if columns already exist
        cursor.execute("PRAGMA table_info(chat_messages)")
        columns = [row[1] for row in cursor.fetchall()]
        
        # Add columns if they don't exist
        if "message_type" not in columns:
            print("Adding message_type column...")
            cursor.execute("ALTER TABLE chat_messages ADD COLUMN message_type VARCHAR(20) DEFAULT 'text'")
        else:
            print("message_type column already exists")
        
        if "file_path" not in columns:
            print("Adding file_path column...")
            cursor.execute("ALTER TABLE chat_messages ADD COLUMN file_path VARCHAR(500)")
        else:
            print("file_path column already exists")
        
        if "file_name" not in columns:
            print("Adding file_name column...")
            cursor.execute("ALTER TABLE chat_messages ADD COLUMN file_name VARCHAR(255)")
        else:
            print("file_name column already exists")
        
        if "file_size" not in columns:
            print("Adding file_size column...")
            cursor.execute("ALTER TABLE chat_messages ADD COLUMN file_size INTEGER")
        else:
            print("file_size column already exists")
        
        if "mime_type" not in columns:
            print("Adding mime_type column...")
            cursor.execute("ALTER TABLE chat_messages ADD COLUMN mime_type VARCHAR(100)")
        else:
            print("mime_type column already exists")
        
        # Update existing messages to have message_type = 'text'
        cursor.execute("UPDATE chat_messages SET message_type = 'text' WHERE message_type IS NULL")
        
        conn.commit()
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        conn.rollback()
        print(f"\n❌ Migration failed: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    print("Starting database migration...")
    migrate_database()

