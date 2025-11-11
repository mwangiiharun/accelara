import { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import SidePanel from './components/SidePanel';
import AddDownloadModal from './components/AddDownloadModal';
import { DownloadProvider, useDownloads } from './context/DownloadContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { ToastProvider, useToast } from './context/ToastContext';

function AppContent({ startDownload }) {
  const { settings, updateSettings, effectiveTheme } = useSettings();
  const { showToast } = useToast();
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalInitialSource, setModalInitialSource] = useState('');

  useEffect(() => {
    // Remove all theme classes
    document.documentElement.classList.remove('theme-light', 'theme-dark', 'theme-cyan');
    // Add current theme class
    document.documentElement.classList.add(`theme-${effectiveTheme}`);
  }, [effectiveTheme]);

  useEffect(() => {
    // Listen for download completion events to show toast
    const handleDownloadCompleted = (event) => {
      const { fileName } = event.detail;
      showToast(`Download completed: ${fileName}`, 'success', 5000);
    };

    window.addEventListener('download-completed', handleDownloadCompleted);
    return () => {
      window.removeEventListener('download-completed', handleDownloadCompleted);
    };
  }, [showToast]);

  // Removed debug logging to prevent re-renders

  useEffect(() => {
    // Listen for external downloads (magnet links, torrent files)
    // Open the download modal with the source pre-filled instead of starting directly
    if (window.electronAPI) {
      const handleExternalDownload = async (data) => {
        // Set the initial source and open the modal
        setModalInitialSource(data.source);
        setShowAddModal(true);
        // Ensure window is visible and focused
        if (window.electronAPI.focusWindow) {
          await window.electronAPI.focusWindow();
        }
      };

      window.electronAPI.onExternalDownload(handleExternalDownload);

      return () => {
        window.electronAPI.removeListeners('external-download');
      };
    }
  }, []);

  return (
    <>
      <div className="flex h-screen overflow-hidden theme-container">
        <SidePanel />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Dashboard onAddDownload={() => setShowAddModal(true)} />
        </div>
      </div>
      {showAddModal && (
        <AddDownloadModal 
          onClose={() => {
            setShowAddModal(false);
            setModalInitialSource(''); // Clear initial source when closing
          }} 
          initialSource={modalInitialSource}
        />
      )}
    </>
  );
}

function AppInner() {
  const { startDownload } = useDownloads();
  return <AppContent startDownload={startDownload} />;
}

function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <DownloadProvider>
          <AppInner />
        </DownloadProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}

export default App;

