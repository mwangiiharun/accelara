export interface ElectronAPI {
  startDownload: (config: {
    source: string;
    output?: string;
    options?: Record<string, any>;
  }) => Promise<{ downloadId: string }>;
  
  stopDownload: (downloadId: string) => Promise<{ success: boolean }>;
  pauseDownload: (downloadId: string) => Promise<{ success: boolean }>;
  resumeDownload: (downloadId: string) => Promise<{ success: boolean }>;
  removeDownload: (downloadId: string) => Promise<{ success: boolean }>;
  getJunkDataSize: () => Promise<{ size: number; sizeFormatted: string }>;
  clearJunkData: () => Promise<{ success: boolean; deletedSize: number; deletedSizeFormatted: string }>;
  
  getActiveDownloads: () => Promise<any[]>;
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
  
  saveSpeedTestResult: (result: {
    timestamp?: number;
    downloadSpeed: number;
    uploadSpeed: number;
    latency?: { average: number; min: number; max: number };
    location?: { city: string; region: string; country: string; isp: string };
  }) => Promise<{ success: boolean; testId: string }>;
  
  getSpeedTestResults: (limit?: number) => Promise<Array<{
    id: string;
    timestamp: number;
    downloadSpeed: number;
    uploadSpeed: number;
    latency: { average: number; min: number; max: number } | null;
    location: { city: string; region: string; country: string; isp: string } | null;
  }>>;
  
  clearSpeedTestResults: () => Promise<{ success: boolean }>;
  
  startSpeedTest: (testType?: 'full' | 'latency' | 'download' | 'upload') => Promise<{ testId: string; success: boolean }>;
  stopSpeedTest: (testId: string) => Promise<{ success: boolean; error?: string }>;
  onSpeedTestUpdate: (callback: (data: {
    testId: string;
    type: string;
    download_speed?: number;
    upload_speed?: number;
    latency?: { average: number; min: number; max: number; google_ping?: number };
    progress?: number;
    status: string;
  }) => void) => void;
  onSpeedTestComplete: (callback: (data: { testId: string; code: number }) => void) => void;
  onSpeedTestError: (callback: (data: { testId: string; error: string }) => void) => void;
  removeSpeedTestListeners: () => void;
  
  focusWindow: () => Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

