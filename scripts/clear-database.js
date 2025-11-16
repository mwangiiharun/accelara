#!/usr/bin/env node

/**
 * Script to clear all data from the ACCELARA database
 * This will delete all downloads, history, settings, and test results
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const dbPath = path.join(os.homedir(), '.accelara', 'accelara.db');
const dbDir = path.dirname(dbPath);

async function clearDatabase() {
  console.log('Clearing ACCELARA database...');
  console.log('Database path:', dbPath);
  
  if (!fs.existsSync(dbPath)) {
    console.log('Database file does not exist. Nothing to clear.');
    return;
  }
  
  try {
    // Load sql.js
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    
    // Load existing database
    const dbData = fs.readFileSync(dbPath);
    const db = new SQL.Database(dbData);
    
    // Clear all tables
    console.log('Deleting all data from tables...');
    
    db.run('DELETE FROM downloads;');
    console.log('  ✓ Cleared downloads table');
    
    db.run('DELETE FROM download_history;');
    console.log('  ✓ Cleared download_history table');
    
    db.run('DELETE FROM torrent_state;');
    console.log('  ✓ Cleared torrent_state table');
    
    db.run('DELETE FROM http_state;');
    console.log('  ✓ Cleared http_state table');
    
    db.run('DELETE FROM speed_test_results;');
    console.log('  ✓ Cleared speed_test_results table');
    
    // Keep settings table (user preferences)
    // Uncomment the next line if you want to clear settings too:
    // db.run('DELETE FROM settings;');
    // console.log('  ✓ Cleared settings table');
    
    // Save the database
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
    
    db.close();
    
    console.log('\n✓ Database cleared successfully!');
    console.log('All downloads, history, and test results have been removed.');
    console.log('Settings have been preserved.');
  } catch (error) {
    console.error('Error clearing database:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
clearDatabase().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

