const path = require("path");
const fs = require("fs");

module.exports = async function(context) {
  try {
    const platform = context.electronPlatformName;
    
    // Determine bin path based on platform
    let binPath;
    if (platform === "darwin") {
      const resourcesPath = path.join(context.appOutDir, "Contents", "Resources");
      binPath = path.join(resourcesPath, "bin");
    } else if (platform === "win32") {
      const resourcesPath = path.join(context.appOutDir, "resources");
      binPath = path.join(resourcesPath, "bin");
    } else {
      const resourcesPath = path.join(context.appOutDir, "resources");
      binPath = path.join(resourcesPath, "bin");
    }
    
    // Create bin directory if it doesn't exist
    if (!fs.existsSync(binPath)) {
      fs.mkdirSync(binPath, { recursive: true });
    }
    
    // Copy binaries from source
    const projectDir = context.projectDir || context.packager?.projectDir || process.cwd();
    const sourceBinPath = path.join(projectDir, "bin");
    
    if (fs.existsSync(sourceBinPath)) {
      const files = fs.readdirSync(sourceBinPath);
      
      for (const file of files) {
        // Copy both api-wrapper and clidm binaries
        if (file === "api-wrapper" || file === "api-wrapper.exe" || file === "clidm" || file === "clidm.exe") {
          const sourceFile = path.join(sourceBinPath, file);
          let destFileName = file;
          if (platform !== "win32" && file.endsWith(".exe")) {
            destFileName = file.replace(/\.exe$/, "");
          }
          const destFile = path.join(binPath, destFileName);
          
          try {
            fs.copyFileSync(sourceFile, destFile);
            if (platform !== "win32") {
              fs.chmodSync(destFile, 0o755);
            }
            console.log(`afterPack: Copied ${file} to ${destFile}`);
            
            // Verify the copy was successful
            if (!fs.existsSync(destFile)) {
              throw new Error(`Copy failed: ${destFile} does not exist after copy`);
            }
            const stats = fs.statSync(destFile);
            if (!stats.isFile()) {
              throw new Error(`Copy failed: ${destFile} is not a file`);
            }
            if (platform !== "win32") {
              try {
                fs.accessSync(destFile, fs.constants.X_OK);
              } catch {
                throw new Error(`Copy failed: ${destFile} is not executable`);
              }
            }
          } catch (err) {
            console.error(`afterPack: Failed to copy ${file}:`, err.message);
            throw err; // Re-throw to fail the build if binary copy fails
          }
        }
      }
    }
  } catch (error) {
    console.error("afterPack: Error:", error.message);
    console.error("afterPack: Stack:", error.stack);
    // Re-throw to fail the build - binary copy is critical
    throw error;
  }
};
