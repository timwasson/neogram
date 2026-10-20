import React, { useState } from 'react';
import { Sparkles, Trash2, Plus, Copy, Check, PenTool } from 'lucide-react';
import { GuestbookEntry } from '../types';
import { RETRO_BADGES } from '../utils/sampleData';
import { retroAudio } from '../utils/audio';

interface RetroWidgetsProps {
  guestbookEntries: GuestbookEntry[];
  onAddGuestbookEntry: (entry: GuestbookEntry) => void;
  onDeleteGuestbookEntry: (id: string) => void;
  visitorCount: number;
  onIncrementCount: (amount?: number) => void;
  onResetCount: () => void;
}

type CounterStyle = 'green_led' | 'red_nixie' | 'odometer' | 'blue_vfd';

export const RetroWidgets: React.FC<RetroWidgetsProps> = ({
  guestbookEntries,
  onAddGuestbookEntry,
  onDeleteGuestbookEntry,
  visitorCount,
  onIncrementCount,
  onResetCount
}) => {
  // Guestbook Form State
  const [gbName, setGbName] = useState('');
  const [gbWebsite, setGbWebsite] = useState('http://');
  const [gbLocation, setGbLocation] = useState('Detroit, MI // Node 313');
  const [gbMood, setGbMood] = useState('😎');
  const [gbMessage, setGbMessage] = useState('');
  const [gbSignedSuccess, setGbSignedSuccess] = useState(false);

  // Counter State
  const [counterStyle, setCounterStyle] = useState<CounterStyle>('green_led');
  const [copiedCounterSnippet, setCopiedCounterSnippet] = useState(false);

  // Custom 88x31 Badge Generator State
  const [badgeTitle, setBadgeTitle] = useState('NEOGRAM');
  const [badgeSubtitle, setBadgeSubtitle] = useState('ONLINE');
  const [badgeBg, setBadgeBg] = useState('#000080');
  const [badgeText, setBadgeText] = useState('#ffffff');
  const [badgeAccentBg, setBadgeAccentBg] = useState('#ff007f');
  const [badgeAccentText, setBadgeAccentText] = useState('#ffff00');
  const [copiedBadgeCode, setCopiedBadgeCode] = useState(false);

  const paddedDigits = visitorCount.toString().padStart(6, '0').split('');

  const handleGuestbookSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gbName.trim() || !gbMessage.trim()) return;

    retroAudio.playSuccess();
    const newEntry: GuestbookEntry = {
      id: `gb-${Date.now()}`,
      name: gbName.trim(),
      website: gbWebsite.trim() === 'http://' ? '' : gbWebsite.trim(),
      location: gbLocation.trim() || 'Cyberspace',
      moodIcon: gbMood,
      message: gbMessage.trim(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    onAddGuestbookEntry(newEntry);
    setGbMessage('');
    setGbSignedSuccess(true);
    setTimeout(() => setGbSignedSuccess(false), 4000);
  };

  const getCounterStyleClasses = (style: CounterStyle) => {
    switch (style) {
      case 'red_nixie':
        return {
          bg: 'bg-[#210202] border-[#ff3300]',
          digit: 'text-[#ff3300] bg-[#3a0606] border-[#550a0a]',
        };
      case 'odometer':
        return {
          bg: 'bg-[#111111] border-[#888888]',
          digit: 'text-white bg-black border-[#333333]',
        };
      case 'blue_vfd':
        return {
          bg: 'bg-[#021820] border-[#00ffff]',
          digit: 'text-[#00ffff] bg-[#032836] border-[#064257]',
        };
      case 'green_led':
      default:
        return {
          bg: 'bg-[#051405] border-[#00ff66]',
          digit: 'text-[#00ff66] bg-[#0c290c] border-[#144214]',
        };
    }
  };

  const currentCounterStyle = getCounterStyleClasses(counterStyle);

  const copyCounterCode = () => {
    retroAudio.playClick();
    const code = `<div class="neogram-counter">\n  <img src="https://neogram.web/counter.cgi?user=cyber_phantom&style=${counterStyle}" alt="You are visitor number" />\n</div>`;
    navigator.clipboard?.writeText(code);
    setCopiedCounterSnippet(true);
    setTimeout(() => setCopiedCounterSnippet(false), 2500);
  };

  const copyBadgeSnippet = () => {
    retroAudio.playClick();
    const code = `<a href="https://neogram.web/u/cyber_phantom" target="_blank">\n  <span class="neogram-badge" style="background:${badgeBg};color:${badgeText};">${badgeTitle}<span style="background:${badgeAccentBg};color:${badgeAccentText};padding:0 3px;">${badgeSubtitle}</span></span>\n</a>`;
    navigator.clipboard?.writeText(code);
    setCopiedBadgeCode(true);
    setTimeout(() => setCopiedBadgeCode(false), 2500);
  };

  return (
    <div className="py-6 px-3 sm:px-6">
      {/* Intro Header */}
      <div className="max-w-6xl mx-auto mb-6 bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] p-3 pixel-box text-black dark:text-[#e6edf3]">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-lg">🕹️</span>
            <div>
              <span className="font-bold text-sm">RETRO WIDGETS SUITE: GUESTBOOK &amp; HIT COUNTER</span>
              <p className="text-gray-700 dark:text-gray-400 text-[11px]">
                Drop-in, zero-dependency HTML components with BEM hooks (`.neogram-guestbook`, `.neogram-counter`).
              </p>
            </div>
          </div>
          <div className="text-[11px] font-mono bg-black text-[#39ff14] px-2.5 py-1 border-2 border-black">
            :&gt; STATUS: STATIC_EMBED_READY
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN: Classic Guestbook Form & Ledger */}
        <div className="lg:col-span-7 space-y-6">
          <div className="neogram-guestbook pixel-box bg-[#dcd8d0] dark:bg-[#161b22] p-1 border-4 border-black dark:border-[#384252]">
            {/* Titlebar with Mac/Unix close box */}
            <div className="bg-[#2a2c30] text-white px-3 py-1.5 flex items-center justify-between text-xs font-mono font-bold mb-3 select-none border-b-2 border-black">
              <div className="flex items-center gap-2">
                <PenTool className="w-3.5 h-3.5 text-[#39ff14]" />
                <span>guestbook_daemon.cgi — PUBLIC VISITOR LEDGER</span>
              </div>
              <div className="text-[10px] bg-black text-[#39ff14] px-1.5 py-0.5 border border-[#39ff14]">
                {guestbookEntries.length} SIGNATURES
              </div>
            </div>

            <div className="p-3 text-black dark:text-[#e6edf3]">
              <p className="text-xs text-gray-800 dark:text-gray-300 mb-4 font-mono">
                :&gt; Leave your mark on this web server! Every visitor helps preserve early internet culture.
              </p>

              {/* Form */}
              <form onSubmit={handleGuestbookSubmit} className="space-y-3 mb-6 bg-white/60 dark:bg-[#0d1117] p-3.5 border-3 border-black dark:border-[#384252]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                  <div>
                    <label className="block text-[11px] font-bold mb-1">YOUR HANDLE / ALIAS: *</label>
                    <input
                      type="text"
                      required
                      value={gbName}
                      onChange={(e) => setGbName(e.target.value)}
                      placeholder="AcidBurn_01"
                      className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#161b22]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold mb-1">HOMEPAGE URL:</label>
                    <input
                      type="text"
                      value={gbWebsite}
                      onChange={(e) => setGbWebsite(e.target.value)}
                      placeholder="http://geocities.com/..."
                      className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#161b22]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold mb-1">LOCATION / BBS NODE:</label>
                    <input
                      type="text"
                      value={gbLocation}
                      onChange={(e) => setGbLocation(e.target.value)}
                      placeholder="Chicago, IL // Area Code 312"
                      className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#161b22]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold mb-1">VISITOR MOOD:</label>
                    <select
                      value={gbMood}
                      onChange={(e) => setGbMood(e.target.value)}
                      className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#161b22] cursor-pointer"
                    >
                      <option value="😎">😎 Radical</option>
                      <option value="💾">💾 Techie</option>
                      <option value="🕹️">🕹️ Gamer</option>
                      <option value="✨">✨ Surfer</option>
                      <option value="👾">👾 Cyber</option>
                    </select>
                  </div>
                </div>

                <div className="font-mono">
                  <label className="block text-[11px] font-bold mb-1">MESSAGE / COMMENTS: *</label>
                  <textarea
                    required
                    rows={3}
                    value={gbMessage}
                    onChange={(e) => setGbMessage(e.target.value)}
                    placeholder=":> Awesome site! Love the blocky pixel art and Mac/Unix aesthetic..."
                    className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#161b22]"
                  />
                </div>

                <div className="flex items-center justify-between pt-1 font-mono">
                  <span className="text-[10px] text-gray-600 dark:text-gray-400">* Required for CGI script</span>
                  <button
                    type="submit"
                    className="pixel-btn bg-[#000080] text-white dark:bg-[#58a6ff] dark:text-black font-bold py-1.5 px-4 text-xs"
                  >
                    <span>✍️ Sign Guestbook</span>
                  </button>
                </div>

                {gbSignedSuccess && (
                  <div className="p-2 bg-[#d4edda] text-[#155724] border-2 border-[#c3e6cb] text-xs font-mono font-bold flex items-center gap-1.5">
                    <span>✓ Signature committed to disk! Thanks for stopping by.</span>
                  </div>
                )}
              </form>

              {/* Entries Ledger */}
              <div className="space-y-3 font-mono">
                <div className="font-bold text-xs uppercase tracking-wider border-b-2 border-current pb-1 flex items-center justify-between">
                  <span>PUBLIC SIGNATURE LEDGER</span>
                  <span className="text-[11px] font-normal text-gray-600 dark:text-gray-400">Latest entries first</span>
                </div>

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {guestbookEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="bg-white dark:bg-[#0d1117] border-3 border-black dark:border-[#384252] p-3 pixel-box space-y-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-300 dark:border-gray-700 pb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{entry.moodIcon}</span>
                          <span className="font-bold">{entry.name}</span>
                          <span className="text-gray-500 text-[11px]">from {entry.location}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 font-mono">{entry.date}</span>
                          <button
                            onClick={() => {
                              retroAudio.playClick();
                              onDeleteGuestbookEntry(entry.id);
                            }}
                            title="Delete entry (admin)"
                            className="text-red-600 hover:text-red-800 text-[10px] p-0.5 border border-red-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {entry.website && (
                        <div className="text-[11px] font-mono text-[#000080] dark:text-[#58a6ff]">
                          <a href={entry.website} target="_blank" rel="noreferrer" className="underline">
                            🌐 {entry.website}
                          </a>
                        </div>
                      )}

                      <p className="font-mono whitespace-pre-wrap text-xs bg-gray-50 dark:bg-black/30 p-2 border border-gray-200 dark:border-gray-800">
                        "{entry.message}"
                      </p>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Digital Web Counter + 88x31 Button Builder */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* DIGITAL WEB COUNTER BOX */}
          <div className="bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] pixel-box p-1 text-black dark:text-[#e6edf3]">
            {/* Titlebar */}
            <div className="bg-[#2a2c30] text-white px-3 py-1.5 flex items-center justify-between text-xs font-mono font-bold mb-3 select-none border-b-2 border-black">
              <div className="flex items-center gap-1.5">
                <span>🔢</span>
                <span>hit_counter_daemon.out</span>
              </div>
              <span className="text-[#39ff14] text-[10px] font-mono">ODOMETER</span>
            </div>

            <div className="p-3 space-y-4 font-mono">
              <div className="text-center font-bold text-xs uppercase tracking-wider">
                *** YOU ARE VISITOR NUMBER ***
              </div>

              {/* The Chunky Digital Counter Display */}
              <div className="flex justify-center my-3">
                <div className={`p-2.5 border-4 inline-flex items-center gap-1 ${currentCounterStyle.bg}`}>
                  {paddedDigits.map((digit, idx) => (
                    <div
                      key={idx}
                      className={`w-9 h-12 flex items-center justify-center font-mono font-bold text-2xl border-2 ${currentCounterStyle.digit}`}
                      style={{ textShadow: counterStyle === 'odometer' ? 'none' : '0 0 8px currentColor' }}
                    >
                      {digit}
                    </div>
                  ))}
                </div>
              </div>

              {/* Hardware Palette */}
              <div>
                <label className="block text-[11px] font-bold mb-1">HARDWARE PALETTE:</label>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {[
                    { id: 'green_led', label: '🟢 Green Phosphor' },
                    { id: 'red_nixie', label: '🔴 Red Nixie Tube' },
                    { id: 'odometer', label: '⚪ B&W Mechanical' },
                    { id: 'blue_vfd', label: '🔵 Cyan VFD Tube' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        retroAudio.playClick();
                        setCounterStyle(s.id as CounterStyle);
                      }}
                      className={`pixel-btn text-xs py-1 ${counterStyle === s.id ? 'bg-[#000080] text-white dark:bg-[#58a6ff] dark:text-black font-bold' : ''}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Counter Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t-2 border-gray-400 dark:border-gray-700">
                <button
                  onClick={() => {
                    retroAudio.playCounterTick();
                    onIncrementCount(1);
                  }}
                  className="pixel-btn bg-[#ffff99] text-black font-bold py-2 text-xs flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Simulate Visit (+1)</span>
                </button>

                <button
                  onClick={() => {
                    retroAudio.playDialupBeep();
                    onIncrementCount(10);
                  }}
                  className="pixel-btn text-xs py-2 flex items-center justify-center gap-1"
                >
                  <span>🕸️ Web Crawl (+10)</span>
                </button>
              </div>

              <div className="flex items-center justify-between text-xs">
                <button
                  onClick={() => {
                    retroAudio.playClick();
                    onResetCount();
                  }}
                  className="underline text-[11px] text-gray-700 dark:text-gray-300"
                >
                  [Reset to 000001]
                </button>

                <button
                  onClick={copyCounterCode}
                  className="pixel-btn text-xs flex items-center gap-1"
                >
                  {copiedCounterSnippet ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCounterSnippet ? 'Copied HTML!' : 'Copy Counter Tag'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 88x31 BADGE CREATOR */}
          <div className="bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] pixel-box p-1 text-black dark:text-[#e6edf3]">
            {/* Titlebar */}
            <div className="bg-[#2a2c30] text-white px-3 py-1.5 flex items-center justify-between text-xs font-mono font-bold mb-3 select-none border-b-2 border-black">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#ffff00]" />
                <span>88x31_badge_compiler.sh</span>
              </div>
              <span className="text-[10px] bg-black text-[#39ff14] px-1 font-mono">SPRITE</span>
            </div>

            <div className="p-3 space-y-4 font-mono">
              <div>
                <label className="block text-[11px] font-bold mb-1.5">CLASSIC 88x31 BUTTON REPERTORY:</label>
                <div className="grid grid-cols-3 gap-2">
                  {RETRO_BADGES.map((b) => (
                    <div
                      key={b.id}
                      className="neogram-badge flex flex-col justify-center text-center cursor-pointer hover:scale-105 transition-transform"
                      style={{ backgroundColor: b.bgColor, color: b.textColor }}
                      onClick={() => {
                        retroAudio.playClick();
                        setBadgeTitle(b.title);
                        setBadgeSubtitle(b.subtitle);
                        setBadgeBg(b.bgColor);
                        setBadgeText(b.textColor);
                        setBadgeAccentBg(b.accentBg);
                        setBadgeAccentText(b.accentText);
                      }}
                      title="Click to load into editor"
                    >
                      <span className="text-[8px] leading-tight font-bold">{b.title}</span>
                      <span
                        className="text-[8px] leading-tight font-bold px-1"
                        style={{ backgroundColor: b.accentBg, color: b.accentText }}
                      >
                        {b.subtitle}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Customizer */}
              <div className="bg-white/60 dark:bg-[#0d1117] p-3 border-2 border-black dark:border-[#384252] space-y-2.5">
                <div className="text-xs font-bold border-b border-gray-400 dark:border-gray-700 pb-1">
                  CUSTOMIZE 88x31 BUTTON:
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold">LEFT TEXT:</label>
                    <input
                      type="text"
                      maxLength={10}
                      value={badgeTitle}
                      onChange={(e) => setBadgeTitle(e.target.value.toUpperCase())}
                      className="w-full p-1 text-[11px] font-mono border border-black dark:border-gray-700 bg-white dark:bg-[#161b22]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold">RIGHT ACCENT:</label>
                    <input
                      type="text"
                      maxLength={10}
                      value={badgeSubtitle}
                      onChange={(e) => setBadgeSubtitle(e.target.value.toUpperCase())}
                      className="w-full p-1 text-[11px] font-mono border border-black dark:border-gray-700 bg-white dark:bg-[#161b22]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold">MAIN COLOR:</label>
                    <input
                      type="color"
                      value={badgeBg}
                      onChange={(e) => setBadgeBg(e.target.value)}
                      className="w-full h-6 border border-black cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold">ACCENT COLOR:</label>
                    <input
                      type="color"
                      value={badgeAccentBg}
                      onChange={(e) => setBadgeAccentBg(e.target.value)}
                      className="w-full h-6 border border-black cursor-pointer"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold">PREVIEW:</span>
                    <div
                      className="neogram-badge flex flex-col justify-center text-center"
                      style={{ backgroundColor: badgeBg, color: badgeText }}
                    >
                      <span className="text-[8px] leading-tight font-bold">{badgeTitle}</span>
                      <span
                        className="text-[8px] leading-tight font-bold px-1"
                        style={{ backgroundColor: badgeAccentBg, color: badgeAccentText }}
                      >
                        {badgeSubtitle}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={copyBadgeSnippet}
                    className="pixel-btn text-xs bg-[#ffff99] text-black"
                  >
                    {copiedBadgeCode ? <Check className="w-3 h-3 text-emerald-800" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedBadgeCode ? 'Copied HTML!' : 'Copy Badge HTML'}</span>
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
