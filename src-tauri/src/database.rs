use rusqlite::{Connection, Result};
use std::path::PathBuf;
use dirs::home_dir;

pub fn init() -> Result<()> {
    let db_path = get_db_path();
    
    let conn = Connection::open(&db_path)?;
    
    // Create downloads table with correct column order
    // Column order: id(0), source(1), output(2), type(3), status(4), progress(5), 
    // downloaded(6), total(7), speed(8), error(9), metadata(10), started_at(11), updated_at(12)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS downloads (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            output TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            progress REAL DEFAULT 0,
            downloaded INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            speed INTEGER DEFAULT 0,
            error TEXT,
            metadata TEXT,
            started_at INTEGER,
            updated_at INTEGER
        )",
        [],
    )?;
    
    // Create download_history table with correct column order
    // Column order: id(0), source(1), output(2), type(3), size(4), metadata(5), completed_at(6)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS download_history (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            output TEXT NOT NULL,
            type TEXT NOT NULL,
            size INTEGER,
            metadata TEXT,
            completed_at INTEGER
        )",
        [],
    )?;
    
    // Create settings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;
    
    // Create speed_test_results table with correct column order
    // Column order: id(0), timestamp(1), download_speed(2), upload_speed(3), latency(4), location(5)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS speed_test_results (
            id TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            download_speed REAL NOT NULL,
            upload_speed REAL NOT NULL,
            latency TEXT,
            location TEXT
        )",
        [],
    )?;
    
    Ok(())
}

pub fn get_connection() -> Result<Connection> {
    let db_path = get_db_path();
    Connection::open(&db_path)
}

fn get_db_path() -> PathBuf {
    let mut path = home_dir().expect("Failed to get home directory");
    path.push(".accelara");
    std::fs::create_dir_all(&path).expect("Failed to create .accelara directory");
    path.push("accelara.db");
    path
}

