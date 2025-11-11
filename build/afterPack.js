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
        if (file === "api-wrapper" || file === "api-wrapper.exe") {
          const sourceFile = path.join(sourceBinPath, file);
          let destFileName = file;
          if (platform !== "win32" && file.endsWith(".exe")) {
            destFileName = file.replace(/\.exe$/, "");
          }
          const destFile = path.join(binPath, destFileName);
          
          fs.copyFileSync(sourceFile, destFile);
          if (platform !== "win32") {
            fs.chmodSync(destFile, 0o755);
          }
        }
      }
    }
  } catch (error) {
    console.error("afterPack: Error:", error.message);
    // Don't throw - let electron-builder continue
  }
};
