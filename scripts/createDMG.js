const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Find the app bundle
const releaseDir = path.join(__dirname, '..', 'release');

// Try multiple possible locations (mac-arm64, mac-x64, mac, or just release/)
const possibleDirs = [
  path.join(releaseDir, 'mac-arm64'),
  path.join(releaseDir, 'mac-x64'),
  path.join(releaseDir, 'mac'),
  releaseDir,
];

let appBundle = null;
for (const macDir of possibleDirs) {
  if (fs.existsSync(macDir)) {
    const files = fs.readdirSync(macDir);
    const appFile = files.find(f => f.endsWith('.app'));
    if (appFile) {
      appBundle = path.join(macDir, appFile);
      break;
    }
  }
}

if (!appBundle || !fs.existsSync(appBundle)) {
  console.error('App bundle not found!');
  console.error('Searched in:', possibleDirs.join(', '));
  process.exit(1);
}

console.log('Found app bundle:', appBundle);

// Ensure binaries are copied to the app bundle
const binSource = path.join(__dirname, '..', 'bin');
const binDest = path.join(appBundle, 'Contents', 'Resources', 'bin');

if (fs.existsSync(binSource)) {
  if (!fs.existsSync(binDest)) {
    fs.mkdirSync(binDest, { recursive: true });
    console.log('Created bin directory in app bundle');
  }
  
  const binFiles = fs.readdirSync(binSource);
  for (const file of binFiles) {
    if (file === 'api-wrapper' || file === 'clidm' || file === 'api-wrapper.exe' || file === 'clidm.exe') {
      const sourceFile = path.join(binSource, file);
      let destFile = path.join(binDest, file);
      
      // Remove .exe extension on macOS
      if (process.platform === 'darwin' && file.endsWith('.exe')) {
        destFile = path.join(binDest, file.replace(/\.exe$/, ''));
      }
      
      if (fs.statSync(sourceFile).isFile()) {
        fs.copyFileSync(sourceFile, destFile);
        // Set executable permissions on macOS/Linux
        if (process.platform !== 'win32') {
          fs.chmodSync(destFile, 0o755);
        }
        console.log(`✓ Copied binary: ${file} -> ${path.basename(destFile)}`);
        
        // Verify the copy was successful
        if (!fs.existsSync(destFile)) {
          console.error(`✗ ERROR: Binary copy failed - ${destFile} does not exist!`);
          process.exit(1);
        }
        
        // Verify it's executable (on Unix-like systems)
        if (process.platform !== 'win32') {
          try {
            fs.accessSync(destFile, fs.constants.X_OK);
            console.log(`  ✓ Verified executable permissions`);
          } catch {
            console.error(`✗ ERROR: Binary is not executable: ${destFile}`);
            process.exit(1);
          }
        }
        
        // Verify file size matches
        const sourceStats = fs.statSync(sourceFile);
        const destStats = fs.statSync(destFile);
        if (sourceStats.size !== destStats.size) {
          console.error(`✗ ERROR: Binary size mismatch! Source: ${sourceStats.size}, Dest: ${destStats.size}`);
          process.exit(1);
        }
        console.log(`  ✓ Verified file size: ${(destStats.size / 1024 / 1024).toFixed(2)} MB`);
      }
    }
  }
  
  // Final verification: ensure api-wrapper exists
  const apiWrapperPath = path.join(binDest, 'api-wrapper');
  if (!fs.existsSync(apiWrapperPath)) {
    console.error('✗ CRITICAL ERROR: api-wrapper binary not found after copy!');
    console.error('  Expected location:', apiWrapperPath);
    console.error('  Bin directory contents:');
    if (fs.existsSync(binDest)) {
      try {
        const files = fs.readdirSync(binDest);
        files.forEach(f => console.error(`    - ${f}`));
      } catch {}
    }
    process.exit(1);
  }
  console.log('✓ Final verification: api-wrapper binary confirmed at', apiWrapperPath);
} else {
  console.error('✗ CRITICAL ERROR: bin directory not found at', binSource);
  console.error('  Cannot proceed without Go binaries!');
  process.exit(1);
}

// Rename app bundle if it's still named Electron.app
const appName = path.basename(appBundle);
if (appName === 'Electron.app') {
  const newAppBundle = path.join(path.dirname(appBundle), 'ACCELARA.app');
  console.log('Renaming Electron.app to ACCELARA.app...');
  fs.renameSync(appBundle, newAppBundle);
  appBundle = newAppBundle;
  console.log('✓ App bundle renamed to:', appBundle);
  
  // Update Info.plist to fix icon and name
  const infoPlistPath = path.join(appBundle, 'Contents', 'Info.plist');
  if (fs.existsSync(infoPlistPath)) {
    const plist = require('plist');
    const infoPlist = plist.parse(fs.readFileSync(infoPlistPath, 'utf8'));
    
    infoPlist.CFBundleName = 'ACCELARA';
    infoPlist.CFBundleDisplayName = 'ACCELARA';
    infoPlist.CFBundleExecutable = 'ACCELARA';
    // Fix icon - copy from build/icon.icns if it exists, or rename electron.icns
    const buildIconPath = path.join(__dirname, '..', 'build', 'icon.icns');
    const resourcesPath = path.join(appBundle, 'Contents', 'Resources');
    const electronIconPath = path.join(resourcesPath, 'electron.icns');
    const iconPath = path.join(resourcesPath, 'icon.icns');
    
    if (fs.existsSync(buildIconPath)) {
      fs.copyFileSync(buildIconPath, iconPath);
      infoPlist.CFBundleIconFile = 'icon.icns';
      console.log('✓ Copied icon from build/icon.icns');
    } else if (fs.existsSync(electronIconPath)) {
      fs.renameSync(electronIconPath, iconPath);
      infoPlist.CFBundleIconFile = 'icon.icns';
      console.log('✓ Renamed electron.icns to icon.icns');
    }
    
    fs.writeFileSync(infoPlistPath, plist.build(infoPlist));
    console.log('✓ Updated Info.plist');
    
    // Rename executable
    const executablePath = path.join(appBundle, 'Contents', 'MacOS', 'Electron');
    const newExecutablePath = path.join(appBundle, 'Contents', 'MacOS', 'ACCELARA');
    if (fs.existsSync(executablePath)) {
      fs.renameSync(executablePath, newExecutablePath);
      console.log('✓ Renamed executable');
    }
  }
}

// Check if app.asar exists, if not create it manually (AFTER rename)
// Use the current appBundle path (which may have been renamed)
const finalResourcesPath = path.join(appBundle, 'Contents', 'Resources');
const asarPath = path.join(finalResourcesPath, 'app.asar');
const unpackedPath = path.join(finalResourcesPath, 'app.asar.unpacked');

// Ensure sql.js is unpacked (required for WASM files)
const sqlJsUnpackedPath = path.join(unpackedPath, 'node_modules', 'sql.js');
const sqlJsSourcePath = path.join(__dirname, '..', 'node_modules', 'sql.js');

if (!fs.existsSync(sqlJsUnpackedPath) && fs.existsSync(sqlJsSourcePath)) {
  console.log('⚠ sql.js not unpacked - copying from source...');
  try {
    // Create unpacked directory structure
    const nodeModulesPath = path.join(unpackedPath, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      fs.mkdirSync(nodeModulesPath, { recursive: true });
    }
    
    // Copy sql.js from source node_modules to unpacked location
    fs.cpSync(sqlJsSourcePath, sqlJsUnpackedPath, { recursive: true });
    console.log('✓ Copied sql.js to unpacked location');
  } catch (error) {
    console.warn('⚠ Failed to copy sql.js:', error.message);
    console.warn('   sql.js should be unpacked by electron-builder, but it may not be working correctly');
  }
} else if (fs.existsSync(sqlJsUnpackedPath)) {
  console.log('✓ sql.js already unpacked');
} else if (!fs.existsSync(sqlJsSourcePath)) {
  console.warn('⚠ sql.js source not found at:', sqlJsSourcePath);
  console.warn('   The app may fail to start if sql.js is not included in the build');
}
if (!fs.existsSync(asarPath)) {
  console.log('⚠ app.asar missing - creating it manually...');
  const { execSync } = require('child_process');
  const projectDir = path.join(__dirname, '..');
  
  // Create a temporary app directory with all the files
  const tempAppDir = path.join(projectDir, '.temp-app');
  if (fs.existsSync(tempAppDir)) {
    fs.rmSync(tempAppDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempAppDir, { recursive: true });
  
  // Copy dist files
  const distDir = path.join(projectDir, 'dist');
  if (fs.existsSync(distDir)) {
    fs.cpSync(distDir, path.join(tempAppDir, 'dist'), { recursive: true });
  }
  
  // Copy electron files
  const electronDir = path.join(projectDir, 'electron');
  if (fs.existsSync(electronDir)) {
    fs.cpSync(electronDir, path.join(tempAppDir, 'electron'), { recursive: true });
  }
  
  // Copy package.json
  const packageJson = path.join(projectDir, 'package.json');
  if (fs.existsSync(packageJson)) {
    fs.copyFileSync(packageJson, path.join(tempAppDir, 'package.json'));
  }
  
  // Create asar file
  try {
    // Use system asar directly (prefer /opt/homebrew/bin/asar or /usr/local/bin/asar)
    let asarBinary = '/opt/homebrew/bin/asar';
    if (!fs.existsSync(asarBinary)) {
      asarBinary = '/usr/local/bin/asar';
      if (!fs.existsSync(asarBinary)) {
        // Fallback to npx
        asarBinary = null;
      }
    }
    
    const asarCommand = asarBinary 
      ? `"${asarBinary}" pack "${tempAppDir}" "${asarPath}"`
      : `npx asar pack "${tempAppDir}" "${asarPath}"`;
    
    console.log('Running:', asarCommand);
    execSync(asarCommand, { stdio: 'inherit', cwd: projectDir, shell: true });
    
    // Verify it was created
    if (fs.existsSync(asarPath)) {
      const stats = fs.statSync(asarPath);
      console.log('✓ Created app.asar manually (' + (stats.size / 1024 / 1024).toFixed(2) + ' MB)');
    } else {
      console.error('✗ app.asar was not created at expected path:', asarPath);
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Failed to create app.asar:', error.message);
    if (error.stdout) console.error('stdout:', error.stdout);
    if (error.stderr) console.error('stderr:', error.stderr);
    process.exit(1);
  } finally {
    // Clean up temp directory
    if (fs.existsSync(tempAppDir)) {
      fs.rmSync(tempAppDir, { recursive: true, force: true });
    }
  }
}

// Create DMG
const dmgPath = path.join(releaseDir, 'ACCELARA.dmg');
console.log('Creating DMG:', dmgPath);

try {
  execSync(
    `hdiutil create -volname "ACCELARA" -srcfolder "${appBundle}" -ov -format UDZO "${dmgPath}"`,
    { stdio: 'inherit' }
  );
  console.log('✓ DMG created successfully:', dmgPath);
  
  // Show file size
  const stats = fs.statSync(dmgPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`✓ DMG size: ${sizeMB} MB`);
} catch (error) {
  console.error('Failed to create DMG:', error);
  process.exit(1);
}

