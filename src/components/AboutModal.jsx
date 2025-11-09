import { X, ExternalLink } from 'lucide-react';

export default function AboutModal({ onClose }) {
  const libraries = [
    { name: 'anacrolix/torrent', url: 'https://github.com/anacrolix/torrent', description: 'BitTorrent client library' },
    { name: 'sql.js', url: 'https://github.com/sql-js/sql.js', description: 'SQLite database' },
    { name: 'React', url: 'https://react.dev', description: 'UI framework' },
    { name: 'Electron', url: 'https://www.electronjs.org', description: 'Desktop framework' },
    { name: 'Vite', url: 'https://vitejs.dev', description: 'Build tool' },
    { name: 'Tailwind CSS', url: 'https://tailwindcss.com', description: 'Styling' },
    { name: 'Recharts', url: 'https://recharts.org', description: 'Charts' },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="theme-bg-secondary rounded-lg p-6 w-full max-w-2xl border theme-border max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold theme-text-primary">About ACCELARA</h2>
          <button
            onClick={onClose}
            className="theme-text-secondary hover:theme-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 theme-text-secondary">
          <div>
            <p className="text-lg mb-2">
              <span className="font-semibold theme-text-primary">ACCELARA</span> - High-performance download manager
            </p>
            <p className="text-sm">
              Copyright © 2025 <span className="font-medium theme-text-primary">Mwangii Kinuthia</span>
            </p>
          </div>

          <div className="pt-4 border-t theme-border">
            <h3 className="text-lg font-semibold theme-text-primary mb-3">Open Source Libraries</h3>
            <p className="text-sm theme-text-tertiary mb-4">
              ACCELARA is built with the following open source libraries:
            </p>
            <div className="space-y-2">
              {libraries.map((lib) => (
                <div key={lib.name} className="flex items-start justify-between p-3 theme-bg-tertiary rounded-lg">
                  <div className="flex-1">
                    <a
                      href={lib.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-400 hover:text-primary-300 font-medium flex items-center gap-2"
                    >
                      {lib.name}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <p className="text-xs theme-text-tertiary mt-1">{lib.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t theme-border">
            <p className="text-sm theme-text-tertiary">
              ACCELARA is open source software. Contributions and feedback are welcome.
            </p>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="btn-primary px-6"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
