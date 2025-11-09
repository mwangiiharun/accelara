import { useEffect, useState } from 'react';
import { useDownloads } from '../context/DownloadContext';
import { Zap, Magnet, File, FolderOpen, Trash2 } from 'lucide-react';
import { formatBytes } from '../utils/format';

export default function HistoryPanel() {
  const { history, clearHistory } = useDownloads();
  const [localHistory, setLocalHistory] = useState([]);

  const loadHistory = () => {
    if (window.electronAPI) {
      window.electronAPI.getDownloadHistory().then(setLocalHistory);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [history]);

  const handleClearHistory = async () => {
    if (window.electronAPI) {
      if (window.confirm('Are you sure you want to clear all download history? This action cannot be undone.')) {
        try {
          await window.electronAPI.clearDownloadHistory();
          clearHistory();
          setLocalHistory([]);
        } catch (error) {
          console.error('Failed to clear download history:', error);
          alert('Failed to clear download history');
        }
      }
    }
  };

  const handleOpenFolder = async (outputPath) => {
    if (window.electronAPI && outputPath) {
      try {
        await window.electronAPI.openFolder(outputPath);
      } catch (error) {
        console.error('Failed to open folder:', error);
      }
    }
  };

  const getIcon = (type) => {
    if (type === 'magnet') return <Magnet className="w-4 h-4 text-red-500" />;
    if (type === 'torrent') return <File className="w-4 h-4 text-blue-500" />;
    return <Zap className="w-4 h-4 text-yellow-500" />;
  };

  // Deduplicate history items by ID (combine history from context and database)
  const historyMap = new Map();
  
  // Add items from context history
  history.forEach((item) => {
    if (item.id) {
      historyMap.set(item.id, item);
    }
  });
  
  // Add items from database history (overwrite if exists, but database is source of truth)
  localHistory.forEach((item) => {
    if (item.id) {
      historyMap.set(item.id, item);
    }
  });
  
  // Convert back to array and sort by completion time
  const allHistory = Array.from(historyMap.values()).sort((a, b) => 
    (b.completed_at || b.completedAt || 0) - (a.completed_at || a.completedAt || 0)
  );

  return (
    <div className="card h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h3 className="text-lg font-semibold theme-text-primary">Completed Downloads</h3>
        {allHistory.length > 0 && (
          <button
            onClick={handleClearHistory}
            className="px-3 py-1.5 flex items-center gap-2 text-sm theme-bg-tertiary theme-border border rounded-lg theme-text-secondary hover:theme-text-primary hover:theme-bg-hover transition-colors"
            title="Clear all download history"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {allHistory.length === 0 ? (
          <p className="theme-text-tertiary text-sm">No completed downloads</p>
        ) : (
          <div className="space-y-2">
            {allHistory.map((item, index) => (
              <div
                key={item.id || index}
                className="theme-bg-tertiary rounded-lg p-3 border theme-border hover:theme-bg-hover transition-colors"
              >
                <div className="flex items-start gap-2 mb-2">
                  {getIcon(item.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm theme-text-primary truncate">{item.source}</p>
                    <p className="text-xs theme-text-tertiary truncate">{item.output}</p>
                  </div>
                  {item.output && (
                    <button
                      onClick={() => handleOpenFolder(item.output)}
                      className="p-1 hover:theme-bg-hover rounded transition-colors flex-shrink-0"
                      title="Open folder"
                    >
                      <FolderOpen className="w-4 h-4 theme-text-secondary" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs theme-text-tertiary">
                    {formatBytes(item.size || item.downloaded || item.total || 0)} • {new Date(item.completed_at || item.completedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
