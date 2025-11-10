const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const os = require('os');

const dbPath = path.join(os.homedir(), '.accelara', 'accelara.db');
const dbDir = path.dirname(dbPath);

// Ensure directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db = null;
let SQL = null;

async function getDatabase() {
  if (!db) {
    if (!SQL) {
      SQL = await initSqlJs();
    }
    
    // Load existing database or create new one
    let dbData = null;
    if (fs.existsSync(dbPath)) {
      try {
        dbData = fs.readFileSync(dbPath);
      } catch (err) {
        console.warn('Failed to load existing database, creating new one:', err.message);
      }
    }
    
    db = new SQL.Database(dbData);
    
    // Create tables (sql.js needs separate statements)
    try {
      db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      db.run(`CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        output TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL DEFAULT 0,
        downloaded INTEGER DEFAULT 0,
        total INTEGER DEFAULT 0,
        speed INTEGER DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT
      );`);
      db.run(`CREATE TABLE IF NOT EXISTS download_history (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        output TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER DEFAULT 0,
        completed_at INTEGER NOT NULL,
        metadata TEXT
      );`);
      db.run(`CREATE TABLE IF NOT EXISTS torrent_state (
        download_id TEXT PRIMARY KEY,
        info_hash TEXT NOT NULL,
        piece_count INTEGER NOT NULL,
        piece_states TEXT NOT NULL,
        verified_at INTEGER,
        FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
      );`);
      db.run(`CREATE TABLE IF NOT EXISTS http_state (
        download_id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        file_path TEXT NOT NULL,
        total_size INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        chunk_progress TEXT NOT NULL,
        sha256 TEXT,
        verified_at INTEGER,
        FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
      );`);
      db.run(`CREATE TABLE IF NOT EXISTS speed_test_results (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        download_speed INTEGER DEFAULT 0,
        upload_speed INTEGER DEFAULT 0,
        latency_avg INTEGER,
        latency_min INTEGER,
        latency_max INTEGER,
        location_city TEXT,
        location_region TEXT,
        location_country TEXT,
        location_isp TEXT
      );`);
      saveDatabase();
    } catch (err) {
      console.error('Error creating tables:', err);
    }
  }
  return db;
}

function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (err) {
      console.error('Error saving database:', err);
    }
  }
}

// Helper functions to match better-sqlite3 API
function prepareQuery(database, sql) {
  return {
    run: (...params) => {
      const stmt = database.prepare(sql);
      if (params && params.length > 0) {
        stmt.bind(params);
      }
      stmt.step();
      stmt.free();
      saveDatabase();
    },
    get: (...params) => {
      const stmt = database.prepare(sql);
      if (params && params.length > 0) {
        stmt.bind(params);
      }
      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return result;
    },
    all: (...params) => {
      const stmt = database.prepare(sql);
      if (params && params.length > 0) {
        stmt.bind(params);
      }
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    }
  };
}

// Wrap database to provide better-sqlite3-like API
function wrapDatabase(database) {
  return {
    prepare: (sql) => prepareQuery(database, sql),
    exec: (sql) => {
      database.run(sql);
      saveDatabase();
    },
    close: () => {
      saveDatabase();
      database.close();
    }
  };
}

module.exports = {
  getDatabase: async () => {
    const database = await getDatabase();
    return wrapDatabase(database);
  },
  closeDatabase: () => {
    if (db) {
      saveDatabase();
      db.close();
      db = null;
    }
  }
};
