// Best-effort TV show / movie detection from a torrent/file name, plus a
// Plex-style destination path builder. Good enough to auto-fill the output
// folder for well-named releases; ambiguous cases fall through to 'unknown'
// so the UI can ask instead of guessing.

const QUALITY_TAGS = /\b(1080p|720p|2160p|480p|4k|uhd|hdr|10bit|8bit|x264|x265|h264|h265|hevc|avc|web-?dl|webrip|web|bluray|blu-ray|brrip|bdrip|dvdrip|hdtv|hdrip|camrip|amzn|nf|hulu|dsnp|atvp|remux|proper|repack|extended|unrated|directors?\.?cut|multi|dual\s?audio|aac\d?|ac3|dts(-hd)?|5\.1|7\.1)\b/gi;

// Strip a trailing file extension generically (rather than a hardcoded
// list) so unusual extensions (.iso, .exe, .epub, ...) don't get left
// dangling as a stray word. Requires at least one letter in the candidate
// so a numeric version segment like "24.04" is never mistaken for one.
function stripExtension(name) {
  const m = name.match(/\.([A-Za-z0-9]{1,5})$/);
  if (m && /[A-Za-z]/.test(m[1])) {
    return name.slice(0, -m[0].length);
  }
  return name;
}

function cleanTitle(raw) {
  return raw
    .replace(QUALITY_TAGS, ' ')
    .replace(/[[\](){}]/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.\-]+$/, '')
    .replace(/^-+\s*/, '');
}

/**
 * Detect whether a release name looks like a TV show or a movie.
 * Returns { type: 'tv'|'movie'|'unknown', title, year, season, episode }
 */
export function detectMediaType(rawName) {
  if (!rawName) {
    return { type: 'unknown', title: '', year: null, season: null, episode: null };
  }

  let name = rawName.split('/').pop().split('\\').pop();
  name = stripExtension(name);
  name = name.replace(/[._]/g, ' ').trim();

  // TV: "Show Name S01E02"
  let m = name.match(/^(.*?)[\s.\-]*[Ss](\d{1,2})[Ee](\d{1,3})/);
  if (m) {
    return { type: 'tv', title: cleanTitle(m[1]), season: parseInt(m[2], 10), episode: parseInt(m[3], 10), year: null };
  }

  // TV: "Show Name 1x02"
  m = name.match(/^(.*?)[\s.\-]*(\d{1,2})x(\d{2,3})\b/i);
  if (m) {
    return { type: 'tv', title: cleanTitle(m[1]), season: parseInt(m[2], 10), episode: parseInt(m[3], 10), year: null };
  }

  // TV: "Show Name Season 2"
  m = name.match(/^(.*?)[\s.\-]*season[\s.\-]*(\d{1,2})\b/i);
  if (m) {
    return { type: 'tv', title: cleanTitle(m[1]), season: parseInt(m[2], 10), episode: null, year: null };
  }

  // Movie: a (19xx/20xx) or bare 19xx/20xx year token
  m = name.match(/^(.*?)[\s.\-([]*((?:19|20)\d{2})\b/);
  if (m) {
    return { type: 'movie', title: cleanTitle(m[1]), year: parseInt(m[2], 10), season: null, episode: null };
  }

  return { type: 'unknown', title: cleanTitle(name), year: null, season: null, episode: null };
}

/**
 * True if a name has a real file extension (e.g. "movie.mkv" -> true,
 * "Ubuntu.Server.24.04.Complete" -> false, ".gitignore" -> false).
 */
export function hasExtension(name) {
  if (!name) return false;
  const base = name.split('/').pop().split('\\').pop();
  const idx = base.lastIndexOf('.');
  return idx > 0 && idx < base.length - 1;
}

/**
 * Build a Plex-friendly destination for a detection result and the user's
 * configured library roots.
 *
 * When the item isn't sorted into a TV/movie library (unknown type, "Other",
 * or the relevant library path isn't configured), it still doesn't get
 * dumped loose into the default download folder as long as it looks like a
 * single file (has an extension) - it gets its own same-named folder
 * instead, same as a multi-file torrent already would. An extensionless
 * name is left as-is, since that already looks like a directory/self-
 * contained item (e.g. a multi-file torrent's release folder name).
 *
 * `opts.rawName` is the original file/torrent name, used only to decide
 * whether to wrap and to derive the wrapper folder's name.
 * `opts.fileName`, if given, is appended to the result - use this for HTTP
 * downloads where the output must be a full file path; omit it for
 * torrents, where the output is just the destination directory and the Go
 * downloader appends the torrent's own name itself.
 */
export function buildLibraryPath(detected, { tvShowsPath, moviesPath, defaultPath }, opts = {}) {
  const { rawName, fileName } = opts;
  const title = detected.title || 'Unknown';
  let folder;

  if (detected.type === 'tv' && tvShowsPath) {
    const seasonFolder = detected.season ? `Season ${String(detected.season).padStart(2, '0')}` : null;
    folder = seasonFolder ? `${tvShowsPath}/${title}/${seasonFolder}` : `${tvShowsPath}/${title}`;
  } else if (detected.type === 'movie' && moviesPath) {
    const folderName = detected.year ? `${title} (${detected.year})` : title;
    folder = `${moviesPath}/${folderName}`;
  } else if (hasExtension(rawName)) {
    folder = `${defaultPath}/${title}`;
  } else {
    folder = defaultPath;
  }

  return fileName ? `${folder}/${fileName}` : folder;
}
