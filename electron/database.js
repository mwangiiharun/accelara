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
      // Dynamically require sql.js to handle ASAR unpacking
      let initSqlJs;
      
      // Check if we're in production (packaged app)
      // In ASAR, __dirname will be something like /path/to/app.asar/electron
      const isProduction = __dirname.includes('.asar') || (process.resourcesPath && !__dirname.includes('node_modules'));
      
      if (isProduction) {
        // Try multiple paths in order of preference
        const possiblePaths = [
          // 1. Unpacked location (preferred)
          path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js'),
          // 2. Resources path with node_modules
          path.join(process.resourcesPath, 'node_modules', 'sql.js'),
          // 3. App path (if app.getAppPath is available)
          process.defaultApp ? null : path.join(process.resourcesPath, 'app.asar', 'node_modules', 'sql.js'),
        ].filter(Boolean);
        
        let loaded = false;
        for (const sqlJsPath of possiblePaths) {
          // sql.js main entry point is dist/sql-wasm.js (not index.js)
          const sqlJsMain = path.join(sqlJsPath, 'dist', 'sql-wasm.js');
          if (fs.existsSync(sqlJsMain)) {
            try {
              // Clear cache if this path was previously loaded
              if (require.cache[sqlJsMain]) {
                delete require.cache[sqlJsMain];
              }
              
              // Directly require the main file using absolute path
              // This bypasses Node's module resolution which doesn't work well with unpacked ASAR
              const sqlJsModule = require(sqlJsMain);
              // sql.js exports initSqlJs as the default export or as the module itself
              initSqlJs = sqlJsModule.default || sqlJsModule;
              
              if (typeof initSqlJs !== 'function') {
                throw new Error('sql.js initSqlJs is not a function');
              }
              
              // Initialize with WASM file location
              const wasmPath = path.join(sqlJsPath, 'dist');
              SQL = await initSqlJs({ 
                locateFile: (file) => {
                  const wasmFile = path.join(wasmPath, file);
                  if (fs.existsSync(wasmFile)) {
                    return wasmFile;
                  }
                  // Fallback to relative path
                  return path.join(sqlJsPath, 'dist', file);
                }
              });
              loaded = true;
              console.log('Loaded sql.js from:', sqlJsPath);
              break;
            } catch (err) {
              console.warn('Failed to load sql.js from', sqlJsPath, ':', err.message);
              console.warn('Error stack:', err.stack);
              // Continue to next path
            }
          } else {
            console.warn('sql.js main file not found at:', sqlJsMain);
          }
        }
        
        if (!loaded) {
          // Final fallback: try normal require (might work if sql.js is in ASAR)
          try {
            initSqlJs = require('sql.js');
            SQL = await initSqlJs();
            console.log('Loaded sql.js via normal require');
          } catch (err) {
            console.error('Failed to load sql.js:', err.message);
            console.error('Tried paths:', possiblePaths);
            throw new Error(`Cannot find module 'sql.js'. Please ensure it is included in the build.`);
          }
        }
      } else {
        // Development mode - normal require
        initSqlJs = require('sql.js');
        SQL = await initSqlJs();
      }
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
