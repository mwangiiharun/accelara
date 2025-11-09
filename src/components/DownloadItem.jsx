import { useState } from 'react';
import { useDownloads } from '../context/DownloadContext';
import { Zap, Magnet, File, X, Pause, Play, FolderOpen, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { formatBytes, formatTime } from '../utils/format';
import SpeedChart from './SpeedChart';

export default function DownloadItem({ download }) {
  const { stopDownload, pauseDownload, resumeDownload } = useDownloads();
  const [showChunks, setShowChunks] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  const handleOpenFolder = async () => {
    if (window.electronAPI && download.output) {
      try {
        await window.electronAPI.openFolder(download.output);
      } catch (error) {
        console.error('Failed to open folder:', error);
      }
    }
  };

  const getIcon = () => {
    if (download.type === 'magnet') return <Magnet className="w-5 h-5 text-red-500" />;
    if (download.type === 'torrent') return <File className="w-5 h-5 text-blue-500" />;
    return <Zap className="w-5 h-5 text-yellow-500" />;
  };

  const getStatusColor = () => {
    switch (download.status) {
      case 'completed':
        return 'bg-green-500';
      case 'seeding':
        return 'bg-blue-500';
      case 'downloading':
        return 'bg-primary-500';
      case 'paused':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const progress = download.progress || 0;
  const speed = download.speed || download.download_rate || 0;
  const eta = download.eta || 0;
  const downloaded = download.downloaded || 0;
  const total = download.total || 0;

  return (
    <div className="theme-bg-tertiary rounded-lg p-4 border theme-border hover:theme-bg-hover transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {getIcon()}
          <div className="flex-1 min-w-0">
            <p className="theme-text-primary font-medium truncate">
              {(download.type === 'torrent' || download.type === 'magnet') && download.torrent_name
                ? download.torrent_name
                : download.source}
            </p>
            <p className="text-sm theme-text-tertiary truncate">{download.output}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor()} theme-text-primary`}>
            {download.status}
          </span>
          {(download.status === 'completed' || download.status === 'seeding') && download.output && (
            <button
              onClick={handleOpenFolder}
              className="p-1 hover:theme-bg-hover rounded transition-colors"
              title="Open folder"
            >
              <FolderOpen className="w-4 h-4 theme-text-secondary" />
            </button>
          )}
          {download.status === 'downloading' && (
            <button
              onClick={() => pauseDownload(download.id)}
              className="p-1 hover:theme-bg-hover rounded transition-colors"
              title="Pause download"
            >
              <Pause className="w-4 h-4 theme-text-secondary" />
            </button>
          )}
          {download.status === 'paused' && (
            <button
              onClick={() => resumeDownload(download.id)}
              className="p-1 hover:theme-bg-hover rounded transition-colors"
              title="Resume download"
            >
              <Play className="w-4 h-4 theme-text-secondary" />
            </button>
          )}
          {download.status !== 'completed' && download.status !== 'seeding' && download.status !== 'downloading' && download.status !== 'paused' && (
            <button
              onClick={() => stopDownload(download.id)}
              className="p-1 hover:theme-bg-hover rounded transition-colors"
              title="Stop download"
            >
              <X className="w-4 h-4 theme-text-secondary" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="theme-text-secondary">{formatBytes(downloaded)} / {formatBytes(total)}</span>
          <span className="theme-text-secondary">{Math.round(Math.min(progress, 1.0) * 100)}%</span>
        </div>
        <div className="w-full theme-bg-secondary rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${getStatusColor()}`}
            style={{ width: `${Math.min(progress, 1.0) * 100}%`, maxWidth: '100%' }}
          />
        </div>
        {(download.speed > 0 || download.status === 'paused') && (
          <div className="flex justify-between text-xs mt-1">
            <span className="theme-text-tertiary">
              {download.status === 'paused' ? 'Paused' : `${formatBytes(download.speed || download.download_rate || 0)}/s`}
            </span>
            {download.eta > 0 && download.status !== 'paused' && (
              <span className="theme-text-tertiary">
                ETA: {formatTime(download.eta)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <p className="theme-text-tertiary">Speed</p>
          <p className="theme-text-primary font-medium">{formatBytes(speed)}/s</p>
        </div>
        <div>
          <p className="theme-text-tertiary">ETA</p>
          <p className="theme-text-primary font-medium">
            {download.status === 'paused' ? '--' : eta > 0 ? formatTime(eta) : '--'}
          </p>
        </div>
        {(download.peers !== undefined || download.seeds !== undefined) && (
          <div>
            <p className="theme-text-tertiary">Peers/Seeds</p>
            <p className="theme-text-primary font-medium">
              {download.peers || 0} / {download.seeds || 0}
            </p>
          </div>
        )}
      </div>

      {/* Merging Status */}
      {download.status === 'merging' && (
        <div className="mt-4 pt-4 border-t theme-border">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-blue-400 animate-pulse" />
            <span className="text-sm theme-text-secondary">Merging chunks...</span>
          </div>
          {download.merge_progress !== undefined && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="theme-text-secondary">
                  Chunk {download.merge_chunk || 0} of {download.merge_total || 0}
                </span>
                <span className="theme-text-secondary">
                  {Math.round((download.merge_progress || 0) * 100)}%
                </span>
              </div>
              <div className="w-full theme-bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min((download.merge_progress || 0), 1.0) * 100}%`, maxWidth: '100%' }}
                />
              </div>
              {download.merged_bytes !== undefined && download.total_bytes !== undefined && (
                <div className="text-xs theme-text-tertiary mt-1">
                  {formatBytes(download.merged_bytes)} / {formatBytes(download.total_bytes)}
                </div>
              )}
            </div>
          )}
          {download.verification === 'verified' && (
            <div className="mt-2 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <span>✓</span>
              <span>Chunk sizes verified ({formatBytes(download.chunk_total_size || 0)})</span>
            </div>
          )}
        </div>
      )}

      {/* Verifying Status */}
      {download.status === 'verifying' && (
        <div className="mt-4 pt-4 border-t theme-border">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-yellow-400 animate-pulse" />
            <span className="text-sm theme-text-secondary">
              {download.verify_status === 'checking_existing_files' && 'Checking existing files...'}
              {download.verify_status === 'verifying_pieces' && 'Verifying pieces...'}
              {download.verify_status === 'chunks_verified' && 'Verifying chunks...'}
              {download.verify_status === 'size_verified' && 'Verifying file size...'}
              {download.verify_status === 'checksum_verifying' && 'Verifying checksum...'}
              {download.verify_status === 'checksum_verified' && 'Checksum verified'}
              {download.verify_status === 'verified' && 'Integrity verified'}
              {!download.verify_status && 'Verifying integrity...'}
            </span>
          </div>
          {download.completed_pieces !== undefined && download.piece_count !== undefined && (
            <div className="text-xs theme-text-tertiary mt-1">
              Verified {download.completed_pieces} of {download.piece_count} pieces
            </div>
          )}
          {download.verify_status === 'size_verified' && download.file_size !== undefined && (
            <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <span>✓</span>
              <span>File size verified: {formatBytes(download.file_size)}</span>
            </div>
          )}
          {download.verify_status === 'checksum_verified' && (
            <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <span>✓</span>
              <span>Checksum verified - No corruption detected</span>
            </div>
          )}
          {download.verify_status === 'verified' && (
            <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
              <span>✓</span>
              <span>All pieces verified - Integrity confirmed</span>
            </div>
          )}
        </div>
      )}

      {/* File Progress (Torrent downloads) */}
      {(download.type === 'torrent' || download.type === 'magnet') && download.file_progress && download.file_progress.length > 0 && (
        <div className="mt-4 pt-4 border-t theme-border">
          <button
            onClick={() => setShowFiles(!showFiles)}
            className="flex items-center gap-2 text-sm theme-text-secondary hover:theme-text-primary transition-colors mb-2"
          >
            {showFiles ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <span>File Progress ({download.file_progress.length} files)</span>
          </button>
          {showFiles && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {download.file_progress.map((file, idx) => (
                <div key={idx} className="theme-bg-secondary rounded p-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="theme-text-secondary truncate flex-1 min-w-0" title={file.path}>
                      {file.name || file.path}
                    </span>
                    <span className="theme-text-secondary ml-2 flex-shrink-0">
                      {Math.round((file.progress || 0) * 100)}%
                    </span>
                  </div>
                  <div className="w-full theme-bg-primary rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min((file.progress || 0), 1.0) * 100}%`, maxWidth: '100%' }}
                    />
                  </div>
                  <div className="text-xs theme-text-tertiary mt-1">
                    {formatBytes(file.downloaded || 0)} / {formatBytes(file.total || 0)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chunk Progress (HTTP downloads) */}
      {download.type === 'http' && download.chunk_progress && download.chunk_progress.length > 0 && download.status !== 'merging' && (
        <div className="mt-4 pt-4 border-t theme-border">
          <button
            onClick={() => setShowChunks(!showChunks)}
            className="flex items-center gap-2 text-sm theme-text-secondary hover:theme-text-primary transition-colors mb-2"
          >
            {showChunks ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            <span>Chunk Progress ({download.chunk_progress.length} chunks)</span>
          </button>
          {showChunks && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {download.chunk_progress.map((chunk, idx) => (
                <div key={idx} className="theme-bg-secondary rounded p-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="theme-text-secondary">
                      Chunk {chunk.index + 1}: {formatBytes(chunk.start)} - {formatBytes(chunk.end)}
                    </span>
                    <span className="theme-text-secondary">
                      {Math.round(chunk.progress * 100)}%
                    </span>
                  </div>
                  <div className="w-full theme-bg-primary rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-primary-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(chunk.progress, 1.0) * 100}%`, maxWidth: '100%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Speed Chart for HTTP downloads */}
      {download.type === 'http' && download.speedHistory && download.speedHistory.length > 0 && (
        <div className="mt-4 pt-4 border-t theme-border">
          <SpeedChart 
            title="Download Speed" 
            data={download.speedHistory.map(p => ({ time: p.time, value: p.value }))} 
            color="#0ea5e9"
            height={120}
          />
        </div>
      )}
    </div>
  );
}
