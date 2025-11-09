import DownloadItem from './DownloadItem';
import { Loader2 } from 'lucide-react';

export default function ActiveDownloadsList({ downloads = [] }) {
  // Filter out completed, failed, and cancelled downloads
  const activeDownloads = downloads.filter(
    (download) => 
      download.status !== 'completed' && 
      download.status !== 'failed' && 
      download.status !== 'cancelled'
  );
  
  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4 theme-text-primary">Active Downloads</h2>
      
      {activeDownloads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 theme-text-tertiary">
          <p className="text-lg mb-2">No active downloads</p>
          <p className="text-sm">Click "New Download" to start</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeDownloads.map((download) => (
            <DownloadItem key={download.id} download={download} />
          ))}
        </div>
      )}
    </div>
  );
}

