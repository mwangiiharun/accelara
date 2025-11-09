export interface ElectronAPI {
  startDownload: (config: {
    source: string;
    output?: string;
    options?: Record<string, any>;
  }) => Promise<{ downloadId: string }>;
  
  stopDownload: (downloadId: string) => Promise<{ success: boolean }>;
  pauseDownload: (downloadId: string) => Promise<{ success: boolean }>;
  resumeDownload: (downloadId: string) => Promise<{ success: boolean }>;
  
  getDownloadHistory: () => Promise<any[]>;
  clearDownloadHistory: () => Promise<{ success: boolean }>;
  inspectTorrent: (source: string) => Promise<{
    name: string;
    totalSize: number;
    fileCount: number;
    files: Array<{ path: string; size: number }>;
  }>;
  getHTTPInfo: (source: string) => Promise<{
    fileName: string;
    totalSize: number;
    contentType: string;
    acceptRanges: boolean;
  }>;
  
  getSettings: () => Promise<{
    concurrency: number;
    chunkSize: string;
    rateLimit: string | null;
    uploadLimit: string | null;
    sequentialMode: boolean;
    theme: string;
    connectTimeout: number;
    readTimeout: number;
    retries: number;
  }>;
  
  saveSettings: (settings: any) => Promise<{ success: boolean }>;
  
  onDownloadUpdate: (callback: (data: any) => void) => void;
  onDownloadComplete: (callback: (data: any) => void) => void;
  onExternalDownload: (callback: (data: { type: string; source: string }) => void) => void;
  removeListeners: (channel: string) => void;
  
  selectTorrentFile: () => Promise<string | null>;
  selectDownloadFolder: () => Promise<string | null>;
  openFolder: (folderPath: string) => Promise<{ success: boolean }>;
  
  getSystemTheme: () => Promise<'dark' | 'light'>;
  onSystemThemeChange: (callback: (theme: 'dark' | 'light') => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

