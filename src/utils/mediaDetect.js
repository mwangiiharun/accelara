// Best-effort TV show / movie detection from a torrent/file name, plus a
// Plex-style destination path builder. Good enough to auto-fill the output
// folder for well-named releases; ambiguous cases fall through to 'unknown'
// so the UI can ask instead of guessing.

const QUALITY_TAGS = /\b(1080p|720p|2160p|480p|4k|uhd|hdr|10bit|8bit|x264|x265|h264|h265|hevc|avc|web-?dl|webrip|web|bluray|blu-ray|brrip|bdrip|dvdrip|hdtv|hdrip|camrip|amzn|nf|hulu|dsnp|atvp|remux|proper|repack|extended|unrated|directors?\.?cut|multi|dual\s?audio|aac\d?|ac3|dts(-hd)?|5\.1|7\.1)\b/gi;

const EXTENSIONS = /\.(mkv|mp4|avi|mov|wmv|torrent|zip|rar|7z)$/i;

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
  name = name.replace(EXTENSIONS, '');
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
 * Build a Plex-friendly destination folder from a detection result and the
 * user's configured library roots. Falls back to defaultPath when the type
 * is unknown or a required root isn't configured.
 */
export function buildLibraryPath(detected, { tvShowsPath, moviesPath, defaultPath }) {
  const title = detected.title || 'Unknown';

  if (detected.type === 'tv' && tvShowsPath) {
    const seasonFolder = detected.season ? `Season ${String(detected.season).padStart(2, '0')}` : null;
    return seasonFolder ? `${tvShowsPath}/${title}/${seasonFolder}` : `${tvShowsPath}/${title}`;
  }

  if (detected.type === 'movie' && moviesPath) {
    const folderName = detected.year ? `${title} (${detected.year})` : title;
    return `${moviesPath}/${folderName}`;
  }

  return defaultPath;
}
