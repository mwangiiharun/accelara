import { useDownloads } from '../context/DownloadContext';
import { Zap, Magnet } from 'lucide-react';
import { formatBytes } from '../utils/format';

export default function StatsPanel() {
  const { downloads, stats } = useDownloads();

  // Separate HTTP and torrent downloads
  const httpDownloads = downloads.filter(d => d.type === 'http');
  const torrentDownloads = downloads.filter(d => d.type === 'torrent' || d.type === 'magnet');

  // Get latest HTTP stats
  const httpStats = {
    downloadRate: stats.httpStats.downloadRate.length > 0
      ? stats.httpStats.downloadRate[stats.httpStats.downloadRate.length - 1]?.value || 0
      : httpDownloads.reduce((sum, d) => sum + (d.speed || d.download_rate || 0), 0),
  };

  // Get latest torrent stats
  const torrentStats = {
    downloadRate: stats.torrentStats.downloadRate.length > 0
      ? stats.torrentStats.downloadRate[stats.torrentStats.downloadRate.length - 1]?.value || 0
      : torrentDownloads.reduce((sum, d) => sum + (d.speed || d.download_rate || 0), 0),
    uploadRate: stats.torrentStats.uploadRate.length > 0
      ? stats.torrentStats.uploadRate[stats.torrentStats.uploadRate.length - 1]?.value || 0
      : torrentDownloads.reduce((sum, d) => sum + (d.upload_rate || 0), 0),
    peers: stats.torrentStats.peers.length > 0
      ? stats.torrentStats.peers[stats.torrentStats.peers.length - 1]?.value || 0
      : torrentDownloads.reduce((sum, d) => sum + (d.peers || 0), 0),
    seeds: stats.torrentStats.seeds.length > 0
      ? stats.torrentStats.seeds[stats.torrentStats.seeds.length - 1]?.value || 0
      : torrentDownloads.reduce((sum, d) => sum + (d.seeds || 0), 0),
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
              <span className="theme-text-secondary font-medium text-sm">HTTP Downloads</span>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Download Rate</p>
                <p className="text-xl font-bold theme-text-primary">
                  {formatBytes(httpStats.downloadRate)}/s
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
              <span className="theme-text-secondary font-medium text-sm">Torrent Downloads</span>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Download Rate</p>
                <p className="text-xl font-bold theme-text-primary">
                  {formatBytes(torrentStats.downloadRate)}/s
                </p>
              </div>
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Upload Rate</p>
                <p className="text-xl font-bold theme-text-primary">
                  {formatBytes(torrentStats.uploadRate)}/s
                </p>
              </div>
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Peers</p>
                <p className="text-xl font-bold theme-text-primary">
                  {torrentStats.peers}
                </p>
              </div>
              <div>
                <p className="text-xs theme-text-tertiary mb-1">Seeds</p>
                <p className="text-xl font-bold theme-text-primary">
                  {torrentStats.seeds}
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
