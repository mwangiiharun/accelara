const path = require("path");
const fs = require("fs");

module.exports = async function(context) {
  console.log("afterPack: Starting...");
  console.log("afterPack: appOutDir =", context.appOutDir);
  console.log("afterPack: platform =", context.electronPlatformName);
  console.log("afterPack: projectDir =", context.projectDir || context.packager.projectDir);
  
  // Determine bin path based on platform
  let binPath;
  const platform = context.electronPlatformName;
  
  if (platform === "darwin") {
    // macOS: Contents/Resources/bin
    const resourcesPath = path.join(context.appOutDir, "Contents", "Resources");
    binPath = path.join(resourcesPath, "bin");
  } else if (platform === "win32") {
    // Windows: resources/bin
    const resourcesPath = path.join(context.appOutDir, "resources");
    binPath = path.join(resourcesPath, "bin");
  } else {
    // Linux: resources/bin
    const resourcesPath = path.join(context.appOutDir, "resources");
    binPath = path.join(resourcesPath, "bin");
  }
  
  console.log("afterPack: binPath =", binPath);
  
  // Create bin directory if it doesn't exist
  if (!fs.existsSync(binPath)) {
    fs.mkdirSync(binPath, { recursive: true });
    console.log("afterPack: Created bin directory");
  }
  
  // Copy binaries from source
  const projectDir = context.projectDir || context.packager?.projectDir || process.cwd();
  const sourceBinPath = path.join(projectDir, "bin");
  console.log("afterPack: sourceBinPath =", sourceBinPath);
  console.log("afterPack: sourceBinPath exists =", fs.existsSync(sourceBinPath));
  
  if (fs.existsSync(sourceBinPath)) {
    const files = fs.readdirSync(sourceBinPath);
    console.log("afterPack: Files in bin =", files);
    
    for (const file of files) {
      // Check for both Unix and Windows binary names
      const isApiWrapper = file === "api-wrapper" || file === "api-wrapper.exe";
      const isClidm = file === "clidm" || file === "clidm.exe";
      
      if (isApiWrapper || isClidm) {
        const sourceFile = path.join(sourceBinPath, file);
        // On Windows, keep .exe extension; on Unix, remove it if present
        let destFileName = file;
        if (platform !== "win32" && file.endsWith(".exe")) {
          destFileName = file.replace(/\.exe$/, "");
        }
        const destFile = path.join(binPath, destFileName);
        
        console.log("afterPack: Copying", file, "to", destFile);
        fs.copyFileSync(sourceFile, destFile);
        console.log("afterPack: Copied binary:", file, "->", destFileName);
        
        // Set executable permissions (Unix-like systems only)
        if (platform !== "win32") {
          try {
            fs.chmodSync(destFile, 0o755);
            console.log("afterPack: Set executable permission for", destFileName);
          } catch (err) {
            console.warn("afterPack: Failed to chmod binary:", destFileName, err);
          }
        }
      }
    }
  } else {
    console.warn("afterPack: Source bin directory not found at", sourceBinPath);
  }
  
  console.log("afterPack: Completed");
};

