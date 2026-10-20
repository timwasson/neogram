import React from 'react';
import { Volume2, VolumeX, Code, Moon, Sun, Terminal } from 'lucide-react';
import { retroAudio } from '../utils/audio';

interface TopNavProps {
  activeTab: 'gallery' | 'widgets' | 'embed' | 'uploader';
  setActiveTab: (tab: 'gallery' | 'widgets' | 'embed' | 'uploader') => void;
  soundEnabled: boolean;
  setSoundEnabled: (val: boolean) => void;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  openEmbedModal: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  setActiveTab,
  soundEnabled,
  setSoundEnabled,
  darkMode,
  setDarkMode,
  openEmbedModal
}) => {
  const handleNavClick = (tab: 'gallery' | 'widgets' | 'embed' | 'uploader') => {
    retroAudio.playClick();
    setActiveTab(tab);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    retroAudio.enabled = next;
    setSoundEnabled(next);
    if (next) retroAudio.playClick();
  };

  const toggleTheme = () => {
    retroAudio.playClick();
    setDarkMode(!darkMode);
  };

  return (
    <header className="sticky top-0 z-50 bg-[#dcd8d0] dark:bg-[#161b22] border-b-4 border-black dark:border-[#30363d] select-none text-black dark:text-[#e6edf3]">
      {/* Classic Mac OS Pinstripes Title Accent */}
      <div className="h-2 w-full mac-pinstripes border-b border-black dark:border-[#30363d]"></div>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2 flex items-center justify-between gap-4">
        {/* Zone 1: Brand Wordmark with System Prompt :> */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-6 h-6 bg-black dark:bg-[#58a6ff] border-2 border-black dark:border-white flex items-center justify-center text-[#39ff14] dark:text-black font-mono font-bold text-xs">
            :&gt;
          </div>
          <span className="font-bold text-sm sm:text-base tracking-wider whitespace-nowrap">
            NEOGRAM <span className="text-[#000080] dark:text-[#58a6ff] text-xs font-mono">:&gt; static_gallery</span>
          </span>
        </div>

        {/* Zone 2: Navigation Links (Single-line controls) */}
        <nav className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar py-0.5">
          <button
            onClick={() => handleNavClick('gallery')}
            className={`pixel-btn text-xs py-1 px-2.5 whitespace-nowrap shrink-0 ${
              activeTab === 'gallery'
                ? 'bg-black text-[#39ff14] border-black dark:bg-[#58a6ff] dark:text-black'
                : ''
            }`}
          >
            <span>🖼️</span>
            <span>Photo Gallery</span>
          </button>

          <button
            onClick={() => handleNavClick('widgets')}
            className={`pixel-btn text-xs py-1 px-2.5 whitespace-nowrap shrink-0 ${
              activeTab === 'widgets'
                ? 'bg-black text-[#39ff14] border-black dark:bg-[#58a6ff] dark:text-black'
                : ''
            }`}
          >
            <span>🕹️</span>
            <span>Widgets &amp; Counter</span>
          </button>

          <button
            onClick={() => handleNavClick('embed')}
            className={`pixel-btn text-xs py-1 px-2.5 whitespace-nowrap shrink-0 ${
              activeTab === 'embed'
                ? 'bg-black text-[#39ff14] border-black dark:bg-[#58a6ff] dark:text-black'
                : ''
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>Embed Specs</span>
          </button>

          {/* Direct Link to Port 4000 Creator Studio / Upload Engine */}
          <a
            href="http://localhost:4000/"
            className="pixel-btn text-xs py-1 px-2.5 bg-[#ffff00] text-black font-bold whitespace-nowrap shrink-0 flex items-center gap-1"
            title="Open Neogram Creator Studio on Port 4000 to upload photos"
          >
            <span>🔑</span>
            <span>Upload Photo (Port 4000) :&gt;</span>
          </a>
        </nav>

        {/* Zone 3: Primary Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Dark Mode Toggle */}
          <button
            onClick={toggleTheme}
            title={darkMode ? 'Switch to Classic Light Mode' : 'Switch to Terminal Dark Mode'}
            className="pixel-btn text-xs py-1 px-2 flex items-center gap-1"
          >
            {darkMode ? (
              <>
                <Sun className="w-3.5 h-3.5 text-yellow-400" />
                <span className="hidden md:inline font-mono text-[11px]">LIGHT</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-800" />
                <span className="hidden md:inline font-mono text-[11px]">DARK</span>
              </>
            )}
          </button>

          {/* Sound Toggle */}
          <button
            onClick={toggleSound}
            title={soundEnabled ? 'Mute 8-bit sound' : 'Unmute 8-bit sound'}
            className="pixel-btn text-xs py-1 px-2 flex items-center gap-1"
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-red-500" />
            )}
          </button>

          {/* Embed Modal Button */}
          <button
            onClick={() => {
              retroAudio.playClick();
              openEmbedModal();
            }}
            className="pixel-btn text-xs py-1 px-2.5 bg-[#ffff00] text-black hover:bg-yellow-300 font-bold whitespace-nowrap shrink-0"
          >
            <span>:&gt; EMBED</span>
          </button>
        </div>
      </div>
    </header>
  );
};
