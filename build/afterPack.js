const path = require("path");
const fs = require("fs");

module.exports = async function(context) {
  console.log("afterPack: Starting...");
  console.log("afterPack: appOutDir =", context.appOutDir);
  console.log("afterPack: projectDir =", context.projectDir || context.packager.projectDir);
  
  // Ensure Resources/bin directory exists
  const resourcesPath = path.join(context.appOutDir, "Contents", "Resources");
  const binPath = path.join(resourcesPath, "bin");
  
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
      if (file === "api-wrapper" || file === "clidm") {
        const sourceFile = path.join(sourceBinPath, file);
        const destFile = path.join(binPath, file);
        
        console.log("afterPack: Copying", file, "to", destFile);
        fs.copyFileSync(sourceFile, destFile);
        console.log("afterPack: Copied binary:", file);
        
        // Set executable permissions
        try {
          fs.chmodSync(destFile, 0o755);
          console.log("afterPack: Set executable permission for", file);
        } catch (err) {
          console.warn("afterPack: Failed to chmod binary:", file, err);
        }
      }
    }
  } else {
    console.warn("afterPack: Source bin directory not found at", sourceBinPath);
  }
  
  console.log("afterPack: Completed");
};

