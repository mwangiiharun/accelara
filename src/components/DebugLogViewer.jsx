import { useState, useEffect, useRef } from 'react';
import { X, RefreshCw, FileText, Copy, Check, GripVertical } from 'lucide-react';

export default function DebugLogViewer({ onClose }) {
  const [logs, setLogs] = useState([]);
  const [logPath, setLogPath] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const logContainerRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    loadLogs();
    // Auto-refresh every 5 seconds
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  // Center the modal on mount
  useEffect(() => {
    const centerModal = () => {
      // Use a fixed width estimate for centering (max-w-4xl is ~896px)
      const estimatedWidth = 896;
      const estimatedHeight = window.innerHeight * 0.8;
      const initialX = Math.max(0, (window.innerWidth - estimatedWidth) / 2);
      const initialY = Math.max(0, (window.innerHeight - estimatedHeight) / 2);
      
      setPosition({
        x: initialX,
        y: initialY,
      });
    };
    
    // Set initial position immediately
    centerModal();
    
    // Also try after a short delay to ensure DOM is ready
    const timeout = setTimeout(centerModal, 100);
    return () => clearTimeout(timeout);
  }, []);

  // Handle dragging - only if clicking on the header, not buttons
  const handleMouseDown = (e) => {
    // Don't start dragging if clicking on a button or interactive element
    if (e.target.closest('button') || e.target.closest('a')) {
      return;
    }
    
    if (modalRef.current) {
      const rect = modalRef.current.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      
      setDragOffset({
        x: offsetX,
        y: offsetY,
      });
      setIsDragging(true);
      e.preventDefault();
      e.stopPropagation();
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      e.preventDefault();
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      
      // Constrain to viewport
      const maxWidth = window.innerWidth - 800; // approximate modal width
      const maxHeight = window.innerHeight - 600; // approximate modal height
      
      setPosition({
        x: Math.max(0, Math.min(newX, maxWidth)),
        y: Math.max(0, Math.min(newY, maxHeight)),
      });
    };

    const handleMouseUp = (e) => {
      e.preventDefault();
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp, { passive: false });
    document.body.style.userSelect = 'none'; // Prevent text selection while dragging

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [isDragging, dragOffset]);

  useEffect(() => {
    // Auto-scroll to bottom when logs update
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const loadLogs = async () => {
    if (!window.electronAPI) {
      setLogs(['Tauri API not available']);
      setIsLoading(false);
      return;
    }

    try {
      const [path, recentLogs] = await Promise.all([
        window.electronAPI.getLogPath().catch(() => 'Unknown'),
        window.electronAPI.getRecentLogs(100).catch(() => ['Failed to load logs'])
      ]);
      setLogPath(path);
      setLogs(recentLogs);
    } catch (error) {
      setLogs([`Error loading logs: ${error.message}`]);
    } finally {
      setIsLoading(false);
    }
  };

  const copyLogs = async () => {
    const logText = logs.join('\n');
    try {
      await navigator.clipboard.writeText(logText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy logs:', error);
    }
  };

  const getLogColor = (line) => {
    if (line.includes('[ERROR]')) return 'text-red-400';
    if (line.includes('[WARN]')) return 'text-yellow-400';
    if (line.includes('[INFO]')) return 'text-blue-400';
    return 'theme-text-secondary';
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        ref={modalRef}
        className="theme-bg-secondary rounded-lg w-full max-w-4xl h-[80vh] border theme-border flex flex-col absolute shadow-2xl pointer-events-auto"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          cursor: isDragging ? 'grabbing' : 'default',
        }}
      >
        {/* Header - Draggable */}
        <div
          className="flex items-center justify-between p-4 border-b theme-border cursor-grab active:cursor-grabbing select-none"
          onMouseDown={handleMouseDown}
          style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <GripVertical className="w-5 h-5 theme-text-tertiary flex-shrink-0" />
            <FileText className="w-5 h-5 theme-text-primary flex-shrink-0" />
            <h2 className="text-xl font-semibold theme-text-primary flex-shrink-0">Debug Logs</h2>
            {logPath && (
              <span className="text-xs theme-text-tertiary font-mono truncate ml-2">
                {logPath}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={copyLogs}
              className="p-2 theme-text-secondary hover:theme-text-primary hover:theme-bg-tertiary rounded transition-colors"
              title="Copy logs"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={loadLogs}
              disabled={isLoading}
              className="p-2 theme-text-secondary hover:theme-text-primary hover:theme-bg-tertiary rounded transition-colors disabled:opacity-50"
              title="Refresh logs"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 theme-text-secondary hover:theme-text-primary hover:theme-bg-tertiary rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Log Content */}
        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs select-text"
          style={{ backgroundColor: '#0a0a0a' }}
        >
          {isLoading && logs.length === 0 ? (
            <div className="theme-text-tertiary">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="theme-text-tertiary">No logs available</div>
          ) : (
            logs.map((line, idx) => (
              <div
                key={idx}
                className={`mb-1 ${getLogColor(line)}`}
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {line}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t theme-border text-xs theme-text-tertiary">
          <p>Logs auto-refresh every 5 seconds. Log file: <code className="theme-text-secondary">~/.accelara/accelara.log</code></p>
        </div>
      </div>
    </div>
  );
}

