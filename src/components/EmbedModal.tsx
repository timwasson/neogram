import React, { useState } from 'react';
import { Copy, Check, FileCode, ShieldCheck } from 'lucide-react';
import { retroAudio } from '../utils/audio';

interface EmbedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EmbedModal: React.FC<EmbedModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'iframe' | 'script' | 'bem'>('iframe');
  const [copied, setCopied] = useState<string | null>(null);

  if (!isOpen) return null;

  const iframeSnippet = `<!-- Neogram Retro Feed Embed (Static Web / Neocities / Geocities) -->
<iframe 
  src="https://neogram.web/embed/u/cyber_phantom?theme=workstation" 
  width="100%" 
  height="720" 
  frameborder="0" 
  scrolling="yes"
  title="Cyber Phantom's Neogram Feed">
</iframe>`;

  const scriptSnippet = `<!-- Neogram Lightweight Dynamic JavaScript Widget -->
<div id="neogram-feed-root" data-user="cyber_phantom" data-theme="workstation"></div>
<script 
  src="https://neogram.web/embed.v1.js" 
  async 
  charset="utf-8">
</script>`;

  const bemCssSnippet = `/* Custom Retro CSS Overrides for Neogram BEM Hooks */
.neogram-feed {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
}

/* Post Container - Chunky Pixel Box */
.neogram-post {
  background-color: #dcd8d0;
  border: 4px solid #000000;
  box-shadow: 4px 4px 0px 0px #000000;
  padding: 0.85rem;
}

/* Header & Metadata */
.neogram-post__header {
  display: flex;
  justify-content: space-between;
  border-bottom: 2px solid #000000;
  padding-bottom: 0.5rem;
}
.neogram-post__user { font-weight: bold; }
.neogram-post__avatar { width: 32px; height: 32px; border: 2px solid #000; }
.neogram-post__timestamp { font-size: 11px; font-family: monospace; }

/* Image Media with Chunky Border */
.neogram-post__media { border: 3px solid #000000; overflow: hidden; }

/* Chunky Pixel Action Buttons */
.neogram-button {
  background-color: #dcd8d0;
  border: 2px solid #000000;
  box-shadow: 2px 2px 0px 0px #000000;
  font-family: monospace;
  font-weight: bold;
  cursor: pointer;
  padding: 4px 8px;
}
.neogram-button:active {
  transform: translate(1px, 1px);
  box-shadow: 1px 1px 0px 0px #000000;
}

/* Comments */
.neogram-comment {
  border: 2px solid #000000;
  background: rgba(0,0,0,0.05);
  padding: 0.5rem;
}`;

  const handleCopy = (text: string, type: string) => {
    retroAudio.playClick();
    navigator.clipboard?.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] max-w-3xl w-full pixel-box p-1 text-black dark:text-[#e6edf3]">
        
        {/* Title Bar with Mac OS Pinstripes & Square Close Box */}
        <div className="bg-[#2a2c30] text-white px-3 py-1.5 text-xs font-mono font-bold flex items-center justify-between select-none border-b-2 border-black">
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 bg-white text-black border border-black flex items-center justify-center text-[10px]">■</span>
            <span>embed_specs_manual.txt — NEOGRAM BEM HOOKS</span>
          </div>
          <button
            onClick={() => {
              retroAudio.playClick();
              onClose();
            }}
            className="w-4 h-4 bg-red-600 text-white border border-black flex items-center justify-center text-xs font-bold hover:bg-red-700"
          >
            ✕
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4 font-mono">
          <div className="text-xs text-gray-800 dark:text-gray-300">
            :&gt; Drop this lightweight embed onto your static site (Neocities, GitHub Pages, or self-hosted server). BEM class hooks allow effortless skinning.
          </div>

          {/* Dialog Tabs */}
          <div className="flex items-center gap-1.5 border-b-2 border-current pb-2">
            <button
              onClick={() => {
                retroAudio.playClick();
                setActiveTab('iframe');
              }}
              className={`pixel-btn text-xs ${activeTab === 'iframe' ? 'bg-[#000080] text-white dark:bg-[#58a6ff] dark:text-black font-bold' : ''}`}
            >
              1. IFRAME Embed
            </button>
            <button
              onClick={() => {
                retroAudio.playClick();
                setActiveTab('script');
              }}
              className={`pixel-btn text-xs ${activeTab === 'script' ? 'bg-[#000080] text-white dark:bg-[#58a6ff] dark:text-black font-bold' : ''}`}
            >
              2. JavaScript Widget
            </button>
            <button
              onClick={() => {
                retroAudio.playClick();
                setActiveTab('bem');
              }}
              className={`pixel-btn text-xs ${activeTab === 'bem' ? 'bg-[#000080] text-white dark:bg-[#58a6ff] dark:text-black font-bold' : ''}`}
            >
              3. BEM CSS Hooks
            </button>
          </div>

          {/* Tab 1: iFrame */}
          {activeTab === 'iframe' && (
            <div className="space-y-3">
              <div className="text-xs text-gray-700 dark:text-gray-400">
                :&gt; Sandboxed iframe element. Best for Neocities static HTML blogs:
              </div>
              <div className="relative">
                <pre className="p-3 text-xs font-mono overflow-x-auto text-[#000080] dark:text-[#58a6ff] bg-white dark:bg-[#0d1117] border-3 border-black dark:border-[#384252] max-h-56">
                  {iframeSnippet}
                </pre>
                <button
                  onClick={() => handleCopy(iframeSnippet, 'iframe')}
                  className="pixel-btn absolute top-2 right-2 text-xs bg-[#ffff99] text-black"
                >
                  {copied === 'iframe' ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
                  <span>{copied === 'iframe' ? 'Copied!' : 'Copy Code'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: JavaScript Widget */}
          {activeTab === 'script' && (
            <div className="space-y-3">
              <div className="text-xs text-gray-700 dark:text-gray-400">
                :&gt; Lightweight DOM injection widget:
              </div>
              <div className="relative">
                <pre className="p-3 text-xs font-mono overflow-x-auto text-[#000080] dark:text-[#58a6ff] bg-white dark:bg-[#0d1117] border-3 border-black dark:border-[#384252] max-h-56">
                  {scriptSnippet}
                </pre>
                <button
                  onClick={() => handleCopy(scriptSnippet, 'script')}
                  className="pixel-btn absolute top-2 right-2 text-xs bg-[#ffff99] text-black"
                >
                  {copied === 'script' ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
                  <span>{copied === 'script' ? 'Copied!' : 'Copy Widget'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: BEM CSS Hooks */}
          {activeTab === 'bem' && (
            <div className="space-y-3">
              <div className="text-xs text-gray-700 dark:text-gray-400">
                :&gt; BEM hooks reference for custom stylesheet overriding:
              </div>
              <div className="relative">
                <pre className="p-3 text-xs font-mono overflow-x-auto text-black dark:text-[#e6edf3] bg-white dark:bg-[#0d1117] border-3 border-black dark:border-[#384252] max-h-64">
                  {bemCssSnippet}
                </pre>
                <button
                  onClick={() => handleCopy(bemCssSnippet, 'bem')}
                  className="pixel-btn absolute top-2 right-2 text-xs bg-[#ffff99] text-black"
                >
                  {copied === 'bem' ? <Check className="w-3 h-3 text-emerald-700" /> : <Copy className="w-3 h-3" />}
                  <span>{copied === 'bem' ? 'Copied CSS!' : 'Copy CSS Tokens'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Bottom Actions */}
          <div className="pt-3 border-t-2 border-current flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
              <ShieldCheck className="w-3.5 h-3.5 text-[#39ff14]" />
              <span>Static compatible · Zero dependencies · Open CORS</span>
            </div>

            <button
              onClick={() => {
                retroAudio.playClick();
                onClose();
              }}
              className="pixel-btn bg-[#dcd8d0] dark:bg-[#21262d] text-black dark:text-white px-4 py-1.5 text-xs font-bold"
            >
              Close Window
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
