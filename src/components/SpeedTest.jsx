import { useState, useEffect, useRef } from 'react';
import { Download, Upload, Gauge, MapPin, RefreshCw, Play, Square, Trash2 } from 'lucide-react';
import { formatBytes } from '../utils/format';
import Speedometer from './Speedometer';
import SpeedChart from './SpeedChart';

export default function SpeedTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [testType, setTestType] = useState(null); // 'download', 'upload', 'latency'
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [latency, setLatency] = useState(null);
  const [googlePing, setGooglePing] = useState(null);
  const [location, setLocation] = useState(null);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState([]);
  const currentTestIdRef = useRef(null);
  const downloadSpeedRef = useRef(0);
  const uploadSpeedRef = useRef(0);
  const latencyRef = useRef(null);
  const googlePingRef = useRef(null);

  // Fetch location and load history on mount
  useEffect(() => {
    fetchLocation();
    loadHistory();

    // Set up IPC listeners for speed test updates
    if (globalThis.electronAPI) {
      const handleUpdate = (data) => {
        if (data.type === 'latency' && data.latency) {
          setLatency(data.latency);
          latencyRef.current = data.latency;
          if (data.latency.google_ping) {
            setGooglePing(data.latency.google_ping);
            googlePingRef.current = data.latency.google_ping;
          } else if (data.latency.googlePing) {
            setGooglePing(data.latency.googlePing);
            googlePingRef.current = data.latency.googlePing;
          }
          setTestType('latency');
        } else if (data.type === 'download' && (data.download_speed !== undefined || data.downloadSpeed !== undefined)) {
          const speed = data.download_speed ?? data.downloadSpeed ?? 0;
          setDownloadSpeed(speed);
          downloadSpeedRef.current = speed;
          setTestType('download');
        } else if (data.type === 'upload' && (data.upload_speed !== undefined || data.uploadSpeed !== undefined)) {
          const speed = data.upload_speed ?? data.uploadSpeed ?? 0;
          setUploadSpeed(speed);
          uploadSpeedRef.current = speed;
          setTestType('upload');
        } else if (data.type === 'full') {
          // Handle full test results
          if (data.download_speed !== undefined || data.downloadSpeed !== undefined) {
            const speed = data.download_speed ?? data.downloadSpeed ?? 0;
            setDownloadSpeed(speed);
            downloadSpeedRef.current = speed;
          }
          if (data.upload_speed !== undefined || data.uploadSpeed !== undefined) {
            const speed = data.upload_speed ?? data.uploadSpeed ?? 0;
            setUploadSpeed(speed);
            uploadSpeedRef.current = speed;
          }
          if (data.latency) {
            setLatency(data.latency);
            latencyRef.current = data.latency;
            if (data.latency.google_ping) {
              setGooglePing(data.latency.google_ping);
              googlePingRef.current = data.latency.google_ping;
            } else if (data.latency.googlePing) {
              setGooglePing(data.latency.googlePing);
              googlePingRef.current = data.latency.googlePing;
            }
          }
        }
        if (data.progress !== undefined) {
          setProgress(data.progress);
        }
      };

      const handleComplete = async (data) => {
        setIsRunning(false);
        setTestType(null);
        setProgress(100);
        
        // If result is included in the completion event, use it
        if (data.result) {
          const result = data.result;
          if (result.download_speed !== undefined || result.downloadSpeed !== undefined) {
            const speed = result.download_speed ?? result.downloadSpeed ?? 0;
            setDownloadSpeed(speed);
            downloadSpeedRef.current = speed;
          }
          if (result.upload_speed !== undefined || result.uploadSpeed !== undefined) {
            const speed = result.upload_speed ?? result.uploadSpeed ?? 0;
            setUploadSpeed(speed);
            uploadSpeedRef.current = speed;
          }
          if (result.latency) {
            setLatency(result.latency);
            latencyRef.current = result.latency;
            if (result.latency.google_ping) {
              setGooglePing(result.latency.google_ping);
              googlePingRef.current = result.latency.google_ping;
            } else if (result.latency.googlePing) {
              setGooglePing(result.latency.googlePing);
              googlePingRef.current = result.latency.googlePing;
            }
          }
        }
        
        // Use refs to get the latest values and save
        setTimeout(async () => {
          await saveResultWithValues(
            downloadSpeedRef.current,
            uploadSpeedRef.current,
            latencyRef.current,
            googlePingRef.current
          );
          await loadHistory(); // Reload history to ensure charts are updated
        }, 500);
      };

      const handleError = (data) => {
        console.error('Speed test error:', data.error);
        setIsRunning(false);
        setTestType(null);
      };

      globalThis.electronAPI.onSpeedTestUpdate(handleUpdate);
      globalThis.electronAPI.onSpeedTestComplete(handleComplete);
      globalThis.electronAPI.onSpeedTestError(handleError);

      return () => {
        globalThis.electronAPI.removeSpeedTestListeners();
      };
    }
  }, []);

  const loadHistory = async () => {
    if (globalThis.electronAPI) {
      try {
        const results = await globalThis.electronAPI.getSpeedTestResults(50);
        setHistory(results);
      } catch (error) {
        console.error('Failed to load speed test history:', error);
      }
    }
  };

  const saveResultWithValues = async (dlSpeed, upSpeed, lat, gp) => {
    if (globalThis.electronAPI) {
      try {
        // Only save if we have meaningful results
        const hasResults = dlSpeed > 0 || upSpeed > 0 || lat;
        if (!hasResults) {
          console.log('No results to save:', { dlSpeed, upSpeed, lat });
          return;
        }
        
        // Include Google ping in latency data if available
        const latencyData = lat ? {
          average: lat.average,
          min: lat.min,
          max: lat.max,
          googlePing: gp || lat.google_ping || lat.average,
        } : null;
        
        const result = await globalThis.electronAPI.saveSpeedTestResult({
          timestamp: Date.now(),
          downloadSpeed: dlSpeed || 0,
          uploadSpeed: upSpeed || 0,
          latency: latencyData,
          location,
        });
        console.log('Speed test result saved:', result);
      } catch (error) {
        console.error('Failed to save speed test result:', error);
      }
    }
  };

  const saveResult = async () => {
    await saveResultWithValues(downloadSpeed, uploadSpeed, latency, googlePing);
  };

  const clearHistory = async () => {
    if (globalThis.electronAPI) {
      try {
        await globalThis.electronAPI.clearSpeedTestResults();
        setHistory([]);
      } catch (error) {
        console.error('Failed to clear speed test history:', error);
      }
    }
  };

  const fetchLocation = async () => {
    try {
      // Use a free IP geolocation API
      const response = await fetch('https://ipapi.co/json/');
      const data = await response.json();
      if (data.city && data.region && data.country_name) {
        setLocation({
          city: data.city,
          region: data.region,
          country: data.country_name,
          isp: data.org || 'Unknown ISP',
        });
      }
    } catch (error) {
      console.error('Failed to fetch location:', error);
      // Fallback to a simpler API
      try {
        const fallback = await fetch('https://ip-api.com/json/');
        const data = await fallback.json();
        if (data.city && data.regionName && data.country) {
          setLocation({
            city: data.city,
            region: data.regionName,
            country: data.country,
            isp: data.isp || 'Unknown ISP',
          });
        }
      } catch (fallbackError) {
        console.error('Fallback location fetch failed:', fallbackError);
        // Location fetch failed, continue without location
      }
    }
  };

  const runFullTest = async () => {
    if (!globalThis.electronAPI) {
      console.error('Electron API not available');
      return;
    }

    setIsRunning(true);
    setTestType('full');
    setDownloadSpeed(0);
    setUploadSpeed(0);
    setLatency(null);
    setGooglePing(null);
    setProgress(0);

    try {
      const result = await globalThis.electronAPI.startSpeedTest('full');
      if (result.success) {
        currentTestIdRef.current = result.testId;
      } else {
        setIsRunning(false);
        setTestType(null);
      }
    } catch (error) {
      console.error('Failed to start speed test:', error);
      setIsRunning(false);
      setTestType(null);
    }
  };

  const stopTest = async () => {
    if (currentTestIdRef.current && globalThis.electronAPI) {
      try {
        await globalThis.electronAPI.stopSpeedTest(currentTestIdRef.current);
      } catch (error) {
        console.error('Failed to stop speed test:', error);
      }
    }
    setIsRunning(false);
    setTestType(null);
    setProgress(0);
    currentTestIdRef.current = null;
  };

  const resetResults = () => {
    setDownloadSpeed(0);
    setUploadSpeed(0);
    setLatency(null);
    setGooglePing(null);
    setProgress(0);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-6 theme-text-primary">Speed Test</h2>

          {/* Location Info */}
          {location && (
            <div className="card mb-6">
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="w-5 h-5 text-primary-400" />
                <h3 className="text-lg font-semibold theme-text-primary">Location</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm theme-text-tertiary">City</p>
                  <p className="font-medium theme-text-primary">{location.city}</p>
                </div>
                <div>
                  <p className="text-sm theme-text-tertiary">Region</p>
                  <p className="font-medium theme-text-primary">{location.region}</p>
                </div>
                <div>
                  <p className="text-sm theme-text-tertiary">Country</p>
                  <p className="font-medium theme-text-primary">{location.country}</p>
                </div>
                <div>
                  <p className="text-sm theme-text-tertiary">ISP</p>
                  <p className="font-medium theme-text-primary">{location.isp}</p>
                </div>
              </div>
            </div>
          )}

          {/* Test Controls */}
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold theme-text-primary">Run Test</h3>
              <div className="flex gap-2">
                {isRunning ? (
                  <button
                    onClick={stopTest}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={runFullTest}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    Start Test
                  </button>
                )}
                <button
                  onClick={resetResults}
                  className="btn-secondary flex items-center gap-2"
                  disabled={isRunning}
                >
                  <RefreshCw className="w-4 h-4" />
                  Reset
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            {isRunning && (
              <div className="mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="theme-text-secondary">
                    {testType === 'latency' && 'Testing Latency...'}
                    {testType === 'download' && 'Testing Download Speed...'}
                    {testType === 'upload' && 'Testing Upload Speed...'}
                    {(!testType || testType === 'full') && progress < 33 && 'Testing Latency...'}
                    {(!testType || testType === 'full') && progress >= 33 && progress < 66 && 'Testing Download Speed...'}
                    {(!testType || testType === 'full') && progress >= 66 && 'Testing Upload Speed...'}
                  </span>
                  <span className="theme-text-secondary">{Math.round(progress)}%</span>
                </div>
                <div className="w-full theme-bg-secondary rounded-full h-2 overflow-hidden relative">
                  <div
                    className="h-2 rounded-full transition-all duration-300 bg-primary-500 relative overflow-hidden"
                    style={{ width: `${Math.min(progress, 100)}%`, maxWidth: '100%' }}
                  >
                    {/* Animated shimmer effect */}
                    <div 
                      className="absolute inset-0 animate-shimmer"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                        width: '50%',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Speedometers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* Download Speedometer */}
            <div className="card flex flex-col items-center">
              <div className="flex items-center gap-2 mb-4">
                <Download className="w-5 h-5 text-blue-500" />
                <h3 className="text-lg font-semibold theme-text-primary">Download</h3>
              </div>
              <Speedometer
                value={downloadSpeed > 0 ? (downloadSpeed / 1024 / 1024 * 8) : 0}
                maxValue={100}
                unit="Mbps"
                label={downloadSpeed > 0 ? formatBytes(downloadSpeed) + '/s' : (isRunning ? 'Testing...' : 'Not tested')}
                color="#0ea5e9"
                isRunning={isRunning}
              />
            </div>

            {/* Upload Speedometer */}
            <div className="card flex flex-col items-center">
              <div className="flex items-center gap-2 mb-4">
                <Upload className="w-5 h-5 text-green-500" />
                <h3 className="text-lg font-semibold theme-text-primary">Upload</h3>
              </div>
              <Speedometer
                value={uploadSpeed > 0 ? (uploadSpeed / 1024 / 1024 * 8) : 0}
                maxValue={100}
                unit="Mbps"
                label={uploadSpeed > 0 ? formatBytes(uploadSpeed) + '/s' : (isRunning ? 'Testing...' : 'Not tested')}
                color="#10b981"
                isRunning={isRunning}
              />
            </div>

            {/* Latency */}
            <div className="card flex flex-col items-center">
              <div className="flex items-center gap-2 mb-4">
                <Gauge className={`w-5 h-5 text-yellow-500 ${isRunning && !latency ? 'animate-pulse' : ''}`} />
                <h3 className="text-lg font-semibold theme-text-primary">Latency</h3>
              </div>
              {latency ? (
                <div className="space-y-2 text-center">
                  <p className="text-3xl font-bold theme-text-primary">{latency.average} ms</p>
                  {googlePing && (
                    <div className="mb-2">
                      <p className="text-xs theme-text-tertiary">Google Ping</p>
                      <p className="text-lg font-semibold theme-text-primary">{googlePing} ms</p>
                    </div>
                  )}
                  <div className="flex gap-4 text-sm justify-center">
                    <div>
                      <p className="theme-text-tertiary">Min</p>
                      <p className="font-medium theme-text-primary">{latency.min} ms</p>
                    </div>
                    <div>
                      <p className="theme-text-tertiary">Max</p>
                      <p className="font-medium theme-text-primary">{latency.max} ms</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  {isRunning ? (
                    <>
                      <div className="w-16 h-16 border-4 border-yellow-500/30 rounded-full animate-spin mb-2" 
                           style={{ borderTopColor: '#eab308' }} />
                      <p className="text-sm theme-text-tertiary animate-pulse">Testing...</p>
                    </>
                  ) : (
                    <p className="text-sm theme-text-tertiary">Not tested</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Historical Charts - Always show if history exists */}
          {history.length > 0 ? (
            <div className="card mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold theme-text-primary">Test History ({history.length} tests)</h3>
                <button
                  onClick={clearHistory}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  Clear History
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {history.some(h => h.downloadSpeed && h.downloadSpeed > 0) && (
                  <SpeedChart
                    title="Download Speed History"
                    data={history
                      .filter(h => h.downloadSpeed && h.downloadSpeed > 0)
                      .map((result) => ({
                        value: result.downloadSpeed / 1024 / 1024 * 8, // Convert to Mbps
                      }))}
                    color="#0ea5e9"
                  />
                )}
                {history.some(h => h.uploadSpeed && h.uploadSpeed > 0) && (
                  <SpeedChart
                    title="Upload Speed History"
                    data={history
                      .filter(h => h.uploadSpeed && h.uploadSpeed > 0)
                      .map((result) => ({
                        value: result.uploadSpeed / 1024 / 1024 * 8, // Convert to Mbps
                      }))}
                    color="#10b981"
                  />
                )}
              </div>
              {history.some(h => h.latency && h.latency.average) && (
                <div className="mt-6">
                  <SpeedChart
                    title="Latency History (Average)"
                    data={history
                      .filter(h => h.latency && h.latency.average)
                      .map((result) => ({
                        value: result.latency.average,
                      }))}
                    color="#f59e0b"
                    format="number"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="card mb-6">
              <p className="text-sm theme-text-tertiary text-center py-4">
                No test history yet. Run a speed test to see historical charts.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

