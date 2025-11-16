#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const BIN_DIR = path.join(PROJECT_ROOT, 'bin');

const REQUIRED_FILES = [
    'index.html',
    'debug-logs.html'
];

const REQUIRED_BINARIES = [
    'api-wrapper',
    'iris'
];

// Determine if we're on Windows
const isWindows = process.platform === 'win32';
const exeExtension = isWindows ? '.exe' : '';

let errors = [];
let warnings = [];

// Check dist files
console.log('🔍 Verifying dist files...');
REQUIRED_FILES.forEach(file => {
    const distPath = path.join(DIST_DIR, file);
    const publicPath = path.join(PUBLIC_DIR, file);
    
    if (!fs.existsSync(distPath)) {
        if (fs.existsSync(publicPath)) {
            // Try to copy from public
            console.log(`⚠️  ${file} missing in dist/, copying from public/...`);
            try {
                fs.copyFileSync(publicPath, distPath);
                console.log(`  ✓ Copied ${file}`);
            } catch (err) {
                errors.push(`Failed to copy ${file}: ${err.message}`);
            }
        } else {
            errors.push(`Required file missing: ${file} (not found in dist/ or public/)`);
        }
    } else {
        console.log(`  ✓ ${file}`);
    }
});

// Check Go binaries
console.log('\n🔍 Verifying Go binaries...');
REQUIRED_BINARIES.forEach(binary => {
    // Check both with and without .exe extension (for Windows)
    const binPath = path.join(BIN_DIR, binary);
    const binPathExe = path.join(BIN_DIR, binary + exeExtension);
    
    // Try the platform-specific name first, then fallback to base name
    let foundPath = null;
    if (fs.existsSync(binPathExe)) {
        foundPath = binPathExe;
    } else if (fs.existsSync(binPath)) {
        foundPath = binPath;
    }
    
    if (!foundPath) {
        errors.push(`Required binary missing: ${binary}${exeExtension} (not found in bin/)`);
    } else {
        // On Unix-like systems, check if executable
        if (!isWindows) {
            try {
                fs.accessSync(foundPath, fs.constants.X_OK);
                console.log(`  ✓ ${binary}`);
            } catch (err) {
                warnings.push(`${binary} exists but is not executable`);
                console.log(`  ⚠️  ${binary} (not executable)`);
            }
        } else {
            // On Windows, just check if file exists
            console.log(`  ✓ ${binary}${exeExtension}`);
        }
    }
});

// Report results
console.log('');
if (warnings.length > 0) {
    console.log('⚠️  Warnings:');
    warnings.forEach(w => console.log(`  - ${w}`));
    console.log('');
}

if (errors.length > 0) {
    console.error('❌ Errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
}

console.log('✅ All resources verified successfully!');
process.exit(0);

