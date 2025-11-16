import { useState } from 'react';
import { useDownloads } from '../context/DownloadContext';
import ActiveDownloadsList from './ActiveDownloadsList';
import SpeedChart from './SpeedChart';
import StatsPanel from './StatsPanel';
import SpeedTest from './SpeedTest';
import { Zap, Download, Globe, Magnet, Activity, ChevronDown, ChevronUp } from 'lucide-react';

export default function Dashboard({ onAddDownload }) {
  const { downloads, stats, highlightedDownloadId } = useDownloads();
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'http', 'torrent', 'speedtest'
  const [chartsExpanded, setChartsExpanded] = useState(true);
  
  const httpDownloads = downloads.filter(d => d.type === 'http');
  const torrentDownloads = downloads.filter(d => d.type === 'torrent' || d.type === 'magnet');
  const displayedDownloads = activeTab === 'http' ? httpDownloads : 
                             activeTab === 'torrent' ? torrentDownloads : 
                             downloads;
  
  // Get highlighted download
  const highlightedDownload = highlightedDownloadId 
    ? downloads.find(d => d.id === highlightedDownloadId)
    : displayedDownloads.length > 0 
      ? displayedDownloads[0] 
      : null;

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <header className="theme-bg-secondary theme-border border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="w-8 h-8 text-primary-400" />
          <h1 className="text-2xl font-bold theme-text-primary">ACCELARA</h1>
        </div>
        <button
          onClick={onAddDownload}
          className="btn-primary flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          New Download
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Tabs - Always visible */}
        <div className="mb-4 flex gap-2 border-b theme-border">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'all'
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'theme-text-secondary hover:theme-text-primary'
            }`}
          >
            All ({downloads.length})
          </button>
          <button
            onClick={() => setActiveTab('http')}
            className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'http'
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'theme-text-secondary hover:theme-text-primary'
            }`}
          >
            <Globe className="w-4 h-4" />
            HTTP ({httpDownloads.length})
          </button>
          <button
            onClick={() => setActiveTab('torrent')}
            className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'torrent'
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'theme-text-secondary hover:theme-text-primary'
            }`}
          >
            <Magnet className="w-4 h-4" />
            Torrents ({torrentDownloads.length})
          </button>
          <button
            onClick={() => setActiveTab('speedtest')}
            className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'speedtest'
                ? 'text-primary-400 border-b-2 border-primary-400'
                : 'theme-text-secondary hover:theme-text-primary'
            }`}
          >
            <Activity className="w-4 h-4" />
            Speed Test
          </button>
        </div>

        {/* Speed Test Tab */}
        {activeTab === 'speedtest' && <SpeedTest />}
        
        {/* Downloads Tabs */}
        {activeTab !== 'speedtest' && (
          <>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Active Downloads */}
          <div className="lg:col-span-2">
            <ActiveDownloadsList downloads={displayedDownloads} />
          </div>

          {/* Stats Panel */}
          <div className="lg:col-span-1">
            <StatsPanel />
          </div>
        </div>

        {/* Charts - Show data for highlighted download */}
        {highlightedDownload && (
          <div className="mt-6">
            <button
              onClick={() => setChartsExpanded(!chartsExpanded)}
              className="flex items-center gap-2 text-lg font-semibold theme-text-primary hover:theme-text-secondary transition-colors mb-4"
            >
              {chartsExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              <span>Charts - {highlightedDownload.torrent_name || highlightedDownload.source.split('/').pop() || 'Download'}</span>
            </button>
            
            {chartsExpanded && (
              <>
                {highlightedDownload.type === 'http' && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SpeedChart 
                      title={`Download Speed - ${highlightedDownload.torrent_name || highlightedDownload.source.split('/').pop() || 'Download'}`}
                      data={highlightedDownload.speedHistory || []} 
                      color="#0ea5e9" 
                    />
                  </div>
                )}
                
                {(highlightedDownload.type === 'torrent' || highlightedDownload.type === 'magnet') && (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <SpeedChart 
                        title={`Download Speed - ${highlightedDownload.torrent_name || 'Torrent'}`}
                        data={highlightedDownload.speedHistory || []} 
                        color="#0ea5e9" 
                      />
                      <SpeedChart 
                        title={`Upload Speed - ${highlightedDownload.torrent_name || 'Torrent'}`}
                        data={highlightedDownload.uploadHistory || []} 
                        color="#10b981" 
                      />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                      <SpeedChart 
                        title={`Peers - ${highlightedDownload.torrent_name || 'Torrent'}`}
                        data={highlightedDownload.peersHistory || []} 
                        color="#f59e0b" 
                        format="number" 
                      />
                      <SpeedChart 
                        title={`Seeds - ${highlightedDownload.torrent_name || 'Torrent'}`}
                        data={highlightedDownload.seedsHistory || []} 
                        color="#8b5cf6" 
                        format="number" 
                      />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        
        {/* Fallback: Show aggregate charts if no highlighted download */}
        {!highlightedDownload && (
          <div className="mt-6">
            <button
              onClick={() => setChartsExpanded(!chartsExpanded)}
              className="flex items-center gap-2 text-lg font-semibold theme-text-primary hover:theme-text-secondary transition-colors mb-4"
            >
              {chartsExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              <span>Aggregate Charts</span>
            </button>
            
            {chartsExpanded && (
              <>
                {activeTab === 'http' && httpDownloads.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SpeedChart title="HTTP Download Speed (All)" data={stats.httpStats.downloadRate} color="#0ea5e9" />
                  </div>
                )}
                
                {activeTab === 'torrent' && torrentDownloads.length > 0 && (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <SpeedChart title="Torrent Download Speed (All)" data={stats.torrentStats.downloadRate} color="#0ea5e9" />
                      <SpeedChart title="Torrent Upload Speed (All)" data={stats.torrentStats.uploadRate} color="#10b981" />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                      <SpeedChart title="Peers (All)" data={stats.torrentStats.peers} color="#f59e0b" format="number" />
                      <SpeedChart title="Seeds (All)" data={stats.torrentStats.seeds} color="#8b5cf6" format="number" />
                    </div>
                  </>
                )}
                
                {activeTab === 'all' && downloads.length > 0 && (
                  <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <SpeedChart title="Download Speed (All)" data={stats.downloadRate} color="#0ea5e9" />
                      <SpeedChart title="Upload Speed (All)" data={stats.uploadRate} color="#10b981" />
                    </div>
                    {(torrentDownloads.length > 0) && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                        <SpeedChart title="Peers (All)" data={stats.peers} color="#f59e0b" format="number" />
                        <SpeedChart title="Seeds (All)" data={stats.seeds} color="#8b5cf6" format="number" />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}

