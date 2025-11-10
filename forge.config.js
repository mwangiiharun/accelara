const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

module.exports = {
  packagerConfig: {
    name: 'ACCELARA',
    executableName: 'ACCELARA',
    asar: true,
    icon: path.resolve(__dirname, 'build/icon'),
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'ACCELARA',
        format: 'UDZO',
        icon: path.resolve(__dirname, 'build/icon.icns'),
        iconSize: 128,
        contents: [
          { x: 380, y: 280, type: 'link', path: '/Applications' },
          { x: 110, y: 280, type: 'file' },
        ],
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    {
      name: '@electron-forge/plugin-fuses',
      config: {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
      },
    },
  ],
  hooks: {
    packageAfterCopy: async (config, buildPath, electronVersion, platform, arch) => {
      // buildPath is the asar app directory (e.g., Electron.app/Contents/Resources/app)
      // We need to go up to Resources and create bin there
      const resourcesPath = path.dirname(buildPath); // Go up from 'app' to 'Resources'
      const binPath = path.join(resourcesPath, 'bin');
      
      console.log('packageAfterCopy: buildPath =', buildPath);
      console.log('packageAfterCopy: resourcesPath =', resourcesPath);
      console.log('packageAfterCopy: binPath =', binPath);
      
      // Create bin directory
      if (!fs.existsSync(binPath)) {
        fs.mkdirSync(binPath, { recursive: true });
        console.log('packageAfterCopy: Created bin directory');
      }
      
      // Copy binaries from source
      const sourceBinPath = path.resolve(__dirname, 'bin');
      console.log('packageAfterCopy: sourceBinPath =', sourceBinPath);
      
      if (fs.existsSync(sourceBinPath)) {
        const files = fs.readdirSync(sourceBinPath);
        console.log('packageAfterCopy: Files in bin =', files);
        
        for (const file of files) {
          if (file === 'api-wrapper' || file === 'clidm') {
            const sourceFile = path.join(sourceBinPath, file);
            const destFile = path.join(binPath, file);
            fs.copyFileSync(sourceFile, destFile);
            fs.chmodSync(destFile, 0o755);
            console.log(`packageAfterCopy: Copied ${file} to ${destFile}`);
          }
        }
      } else {
        console.warn('packageAfterCopy: Source bin directory not found');
      }
    },
  },
};
