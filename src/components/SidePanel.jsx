import { useState } from 'react';
import { History, Settings, CheckCircle, Menu, X, Info } from 'lucide-react';
import HistoryPanel from './HistoryPanel';
import SettingsPanel from './SettingsPanel';
import AboutModal from './AboutModal';

export default function SidePanel() {
  const [activeTab, setActiveTab] = useState('history');
  const [isOpen, setIsOpen] = useState(true);
  const [showAbout, setShowAbout] = useState(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed left-0 top-1/2 -translate-y-1/2 theme-bg-secondary p-2 rounded-r-lg border-r border-y theme-border z-10"
      >
        <Menu className="w-5 h-5 theme-text-secondary" />
      </button>
    );
  }

  return (
    <div className="w-80 theme-bg-secondary theme-border border-r flex flex-col">
      {/* Header */}
      <div className="p-4 border-b theme-border flex items-center justify-between">
        <h2 className="text-lg font-semibold theme-text-primary">Menu</h2>
        <button
          onClick={() => setIsOpen(false)}
          className="theme-text-secondary hover:theme-text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b theme-border">
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'history'
              ? 'theme-bg-tertiary theme-text-primary border-b-2 border-primary-500'
              : 'theme-text-secondary hover:theme-text-primary hover:theme-bg-hover'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          History
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex-1 px-4 py-3 flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'settings'
              ? 'theme-bg-tertiary theme-text-primary border-b-2 border-primary-500'
              : 'theme-text-secondary hover:theme-text-primary hover:theme-bg-hover'
          }`}
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'history' && <HistoryPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </div>

      {/* Footer with About button */}
      <div className="border-t theme-border p-4">
        <button
          onClick={() => setShowAbout(true)}
          className="w-full px-4 py-2 flex items-center justify-center gap-2 theme-bg-tertiary theme-border border rounded-lg theme-text-secondary hover:theme-text-primary hover:theme-bg-hover transition-colors"
          title="About ACCELARA"
        >
          <Info className="w-4 h-4" />
          <span className="text-sm font-medium">About</span>
        </button>
      </div>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
}
