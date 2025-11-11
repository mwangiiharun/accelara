import { createContext, useContext, useState, useEffect } from 'react';

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({
    concurrency: 8,
    chunkSize: '4MB',
    rateLimit: null,
    uploadLimit: null,
    sequentialMode: false,
    theme: 'system',
    connectTimeout: 15,
    readTimeout: 60,
    retries: 5,
    torrentPort: 42069,
  });
  const [systemTheme, setSystemTheme] = useState('dark');

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getSettings()
        .then(setSettings)
        .catch((error) => {
          console.error('Failed to load settings:', error);
        });
      
      // Get initial system theme
      window.electronAPI.getSystemTheme()
        .then(setSystemTheme)
        .catch(() => {});
      
      // Listen for system theme changes
      window.electronAPI.onSystemThemeChange((theme) => {
        setSystemTheme(theme);
      });
    }
  }, []);

  // Compute effective theme
  const effectiveTheme = settings.theme === 'system' ? systemTheme : settings.theme;

  const updateSettings = async (newSettings) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    if (window.electronAPI) {
      await window.electronAPI.saveSettings(updated);
    }
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, effectiveTheme }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}

