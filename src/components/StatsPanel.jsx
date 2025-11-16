import { useDownloads } from '../context/DownloadContext';
import { Zap, Magnet } from 'lucide-react';
import { formatBytes } from '../utils/format';

export default function StatsPanel() {
  const { downloads, stats } = useDownloads();

  // Separate HTTP and torrent downloads
  const httpDownloads = downloads.filter(d => d.type === 'http');
  const torrentDownloads = downloads.filter(d => d.type === 'torrent' || d.type === 'magnet');

  // Calculate total HTTP stats (aggregate all HTTP downloads)
  const httpTotalStats = {
    downloadRate: httpDownloads.reduce((sum, d) => sum + (d.speed || d.download_rate || 0), 0),
    count: httpDownloads.length,
    totalDownloaded: httpDownloads.reduce((sum, d) => sum + (d.downloaded || 0), 0),
    totalSize: httpDownloads.reduce((sum, d) => sum + (d.total || 0), 0),
  };

  // Calculate total torrent stats (aggregate all torrent downloads)
  const torrentTotalStats = {
    downloadRate: torrentDownloads.reduce((sum, d) => sum + (d.speed || d.download_rate || 0), 0),
    uploadRate: torrentDownloads.reduce((sum, d) => sum + (d.upload_rate || 0), 0),
    peers: torrentDownloads.reduce((sum, d) => sum + (d.peers || 0), 0),
    seeds: torrentDownloads.reduce((sum, d) => sum + (d.seeds || 0), 0),
    count: torrentDownloads.length,
    totalDownloaded: torrentDownloads.reduce((sum, d) => sum + (d.downloaded || 0), 0),
    totalSize: torrentDownloads.reduce((sum, d) => sum + (d.total || 0), 0),
  };

  // Get latest HTTP stats from history (for charts)
  const httpStats = {
    downloadRate: stats.httpStats.downloadRate.length > 0
      ? stats.httpStats.downloadRate[stats.httpStats.downloadRate.length - 1]?.value || 0
      : httpTotalStats.downloadRate,
  };

  // Get latest torrent stats from history (for charts)
  const torrentStats = {
    downloadRate: stats.torrentStats.downloadRate.length > 0
      ? stats.torrentStats.downloadRate[stats.torrentStats.downloadRate.length - 1]?.value || 0
      : torrentTotalStats.downloadRate,
    uploadRate: stats.torrentStats.uploadRate.length > 0
      ? stats.torrentStats.uploadRate[stats.torrentStats.uploadRate.length - 1]?.value || 0
      : torrentTotalStats.uploadRate,
    peers: stats.torrentStats.peers.length > 0
      ? stats.torrentStats.peers[stats.torrentStats.peers.length - 1]?.value || 0
      : torrentTotalStats.peers,
    seeds: stats.torrentStats.seeds.length > 0
      ? stats.torrentStats.seeds[stats.torrentStats.seeds.length - 1]?.value || 0
      : torrentTotalStats.seeds,
  };

  const hasHTTP = httpDownloads.length > 0;
  const hasTorrent = torrentDownloads.length > 0;

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4 theme-text-primary">Live Stats</h2>
      
      <div className="space-y-4">
        {/* HTTP Stats */}
        {hasHTTP && (
          <div className="theme-bg-tertiary rounded-lg p-4 border-l-4 border-primary-400">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-primary-400" />
              <span className="theme-text-secondary font-medium text-sm">
                HTTP Downloads {httpTotalStats.count > 1 && `(${httpTotalStats.count})`}
              </span>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Total Download Rate</p>
                <p className="text-xl font-bold theme-text-primary">
                  {formatBytes(httpTotalStats.downloadRate)}/s
                </p>
              </div>
              {httpTotalStats.count > 1 && (
                <div>
                  <p className="text-xs theme-text-tertiary mb-1">Average per Download</p>
                  <p className="text-sm theme-text-secondary">
                    {formatBytes(Math.round(httpTotalStats.downloadRate / httpTotalStats.count))}/s
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Total Downloaded</p>
                <p className="text-sm theme-text-secondary">
                  {formatBytes(httpTotalStats.totalDownloaded)}
                  {httpTotalStats.totalSize > 0 && ` / ${formatBytes(httpTotalStats.totalSize)}`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Torrent Stats */}
        {hasTorrent && (
          <div className="theme-bg-tertiary rounded-lg p-4 border-l-4 border-blue-400">
            <div className="flex items-center gap-2 mb-3">
              <Magnet className="w-4 h-4 text-blue-400" />
              <span className="theme-text-secondary font-medium text-sm">
                Torrent Downloads {torrentTotalStats.count > 1 && `(${torrentTotalStats.count})`}
              </span>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Total Download Rate</p>
                <p className="text-xl font-bold theme-text-primary">
                  {formatBytes(torrentTotalStats.downloadRate)}/s
                </p>
              </div>
              {torrentTotalStats.count > 1 && (
                <div>
                  <p className="text-xs theme-text-tertiary mb-1">Average per Download</p>
                  <p className="text-sm theme-text-secondary">
                    {formatBytes(Math.round(torrentTotalStats.downloadRate / torrentTotalStats.count))}/s
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Total Upload Rate</p>
                <p className="text-xl font-bold theme-text-primary">
                  {formatBytes(torrentTotalStats.uploadRate)}/s
                </p>
              </div>
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Total Peers</p>
                <p className="text-xl font-bold theme-text-primary">
                  {torrentTotalStats.peers}
                </p>
              </div>
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Total Seeds</p>
                <p className="text-xl font-bold theme-text-primary">
                  {torrentTotalStats.seeds}
                </p>
              </div>
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Total Downloaded</p>
                <p className="text-sm theme-text-secondary">
                  {formatBytes(torrentTotalStats.totalDownloaded)}
                  {torrentTotalStats.totalSize > 0 && ` / ${formatBytes(torrentTotalStats.totalSize)}`}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Show message if no active downloads */}
        {!hasHTTP && !hasTorrent && (
          <div className="theme-bg-tertiary rounded-lg p-4 text-center">
            <p className="text-sm theme-text-tertiary">No active downloads</p>
          </div>
        )}
      </div>
    </div>
  );
}
