#!/bin/bash
set -e

VERSION="3.0.3"

# Get the script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Change to project root
cd "$PROJECT_ROOT"

echo "🚀 Starting release process for v${VERSION}..."
echo "📁 Working directory: $PROJECT_ROOT"

# Check if we're on main branch
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo "⚠️  Warning: Not on main branch (currently on $BRANCH)"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo "📝 Staging changes..."
    git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json \
        cmd/api-wrapper/inspect.go internal/downloader/torrent.go \
        src/context/DownloadContext.jsx src/components/DownloadItem.jsx \
        scripts/release.sh 2>/dev/null || true
fi

# Commit changes
echo "💾 Committing version bump..."
git commit -m "Release v${VERSION}: Fix magnet torrent inspection crashes and add retry functionality

- Fix nil pointer dereference in torrent downloader when calling DownloadAll() before metadata is loaded
- Fix goroutine leaks and resource cleanup in magnet link inspection
- Add retry button for failed downloads (HTTP and torrent)
- Implement re-inspection for magnet links on retry
- Fix duplicate download issue when retrying failed downloads
- Improve error handling and user feedback for magnet link inspection" || echo "No changes to commit or already committed"

# Create tag
echo "🏷️  Creating tag v${VERSION}..."
git tag -a "v${VERSION}" -m "Release v${VERSION}

Bug Fixes:
- Fix nil pointer dereference crash when downloading magnet torrents
- Fix goroutine leaks in magnet link inspection
- Fix duplicate downloads when retrying failed downloads

Features:
- Add retry button for failed downloads
- Re-inspect magnet links before retrying
- Improved error handling for torrent inspection" || echo "Tag may already exist"

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin main
git push origin "v${VERSION}"

echo "✅ Release v${VERSION} completed successfully!"
echo "📋 Next steps:"
echo "   1. Go to GitHub and create a release from the v${VERSION} tag"
echo "   2. Add release notes describing the changes"
echo "   3. Build and attach binaries for the release"

