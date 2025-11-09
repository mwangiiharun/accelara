# GitHub Actions Setup Guide

## What's Been Done

1. ✅ Cleaned up build artifacts (`release/` directory)
2. ✅ Updated `.gitignore` to exclude `release/` directory
3. ✅ Updated GitHub Actions workflow to handle different electron-builder output paths
4. ✅ Initialized git repository
5. ✅ Configured remote to `git@github.com:mwangiiharun/accelara.git`

## What You Need to Do on GitHub

### 1. Create the Repository (if it doesn't exist)

If the repository `mwangiiharun/accelara` doesn't exist on GitHub yet:

1. Go to https://github.com/new
2. Repository name: `accelara`
3. Description: "ACCELARA - Unified HTTP + BitTorrent Download Manager"
4. Choose **Private** or **Public** (your choice)
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click "Create repository"

### 2. Push Your Code

```bash
# Add all files
git add .

# Commit
git commit -m "Initial commit: ACCELARA v1.0.0"

# Push to GitHub
git push -u origin main
```

If your default branch is `master` instead of `main`:
```bash
git push -u origin master
# Or rename to main:
git branch -M main
git push -u origin main
```

### 3. Set Up GitHub Actions Permissions

1. Go to your repository: https://github.com/mwangiiharun/accelara
2. Click **Settings** → **Actions** → **General**
3. Under **Workflow permissions**, select:
   - ✅ **Read and write permissions**
   - ✅ **Allow GitHub Actions to create and approve pull requests**
4. Scroll down and click **Save**

### 4. Test the Workflow

#### Option A: Manual Trigger (Recommended for first test)

1. Go to **Actions** tab in your repository
2. Click **Build and Release** workflow
3. Click **Run workflow** button (top right)
4. Enter version: `v1.0.0`
5. Click **Run workflow**

#### Option B: Create a Tag (Triggers automatically)

```bash
# Create and push a tag
git tag v1.0.0
git push origin v1.0.0
```

This will automatically trigger the workflow.

### 5. Monitor the Build

1. Go to **Actions** tab
2. Click on the running workflow
3. Watch the build progress
4. Check each job (mac-x64, mac-arm64, win-x64, linux-x64)

### 6. Download Artifacts

Once the build completes:

1. Click on the completed workflow run
2. Scroll down to **Artifacts** section
3. Download the artifacts you need:
   - `mac-x64-dmg` - macOS Intel DMG
   - `mac-arm64-dmg` - macOS Apple Silicon DMG
   - `win-x64-installer` - Windows installer
   - `linux-x64-appimage` - Linux AppImage

### 7. Create a Release (Automatic)

If you pushed a tag (like `v1.0.0`), the workflow will:
- ✅ Automatically create a GitHub Release
- ✅ Upload all build artifacts
- ✅ Generate SHA256 checksums
- ✅ Create release notes

You can find it at: https://github.com/mwangiiharun/accelara/releases

## Troubleshooting

### Build Fails with "ASAR not found"

The GitHub Actions environment uses Node.js 18 (LTS), which should work correctly with electron-builder. If you still see issues:

1. Check the workflow logs in the **Actions** tab
2. Look for errors in the "Build Electron app" step
3. The workflow will show detailed error messages

### Permission Errors

If you see permission errors:
1. Go to **Settings** → **Actions** → **General**
2. Ensure **Workflow permissions** is set to "Read and write"
3. Save and re-run the workflow

### Artifacts Not Found

If artifacts aren't being created:
1. Check the "Find build artifacts" step logs
2. The workflow now searches more flexibly for build outputs
3. Check electron-builder output paths in the logs

## Next Steps

1. ✅ Push your code to GitHub
2. ✅ Set up workflow permissions
3. ✅ Test the workflow (manual trigger recommended)
4. ✅ Download and test the built artifacts
5. ✅ Create your first release tag

## Notes

- The workflow builds for all platforms (macOS Intel, macOS ARM, Windows, Linux)
- Builds take ~10-15 minutes per platform
- All builds run in parallel
- Releases are created automatically when you push a tag starting with `v`

