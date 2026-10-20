import React, { useState, useRef } from 'react';
import { Sparkles, RefreshCw, Smartphone, Monitor, CheckCircle, Wifi, Terminal } from 'lucide-react';
import { RetroFilter, Post } from '../types';
import { RETRO_SVGS } from '../utils/sampleData';
import { retroAudio } from '../utils/audio';

interface PwaUploaderProps {
  onPublish: (post: Post) => void;
  onGoToFeed: () => void;
}

const PRESET_SPRITES = [
  { label: '🖥️ Pixel Rig', src: RETRO_SVGS.pixelWorkstation, defaultFilter: 'crt' as RetroFilter },
  { label: '🌆 Akiba 8-Bit', src: RETRO_SVGS.pixelSkyline, defaultFilter: 'cyberpunk' as RetroFilter },
  { label: '📼 Spinning Tape', src: RETRO_SVGS.pixelCassette, defaultFilter: 'sepia' as RetroFilter },
  { label: '🕹️ 1UP Arcade', src: RETRO_SVGS.pixelArcade, defaultFilter: 'vga' as RetroFilter },
];

const FILTER_PRESETS: { id: RetroFilter; name: string; desc: string }[] = [
  { id: 'none', name: 'Raw 24-Bit', desc: 'Direct sensor scan' },
  { id: 'crt', name: 'CRT Phosphor', desc: 'Scanlines & green bloom' },
  { id: 'vga', name: '16-Color VGA', desc: 'Chunky dither palette' },
  { id: 'gameboy', name: 'GameBoy 1-Bit', desc: 'Olive LCD dot matrix' },
  { id: 'cyberpunk', name: 'Neon Cyber', desc: 'Magenta & cyan shift' },
  { id: 'sepia', name: '1996 Polaroid', desc: 'Warm print tone' },
];

const MOODS = [
  '[:> CODING IN THE DARK]',
  '[:> COMPILING KERNEL]',
  '[:> DOWNLOADING MIDI]',
  '[:> VIBING TO CITY POP]',
  '[:> SURFING WEBRINGS]',
  '[:> DIAL-UP CONNECTED]',
  '[:> EATING PIZZA]'
];

const WEBRINGS = [
  'unix.hackers.retro',
  'neocities.cyberpunk',
  'geocities.siliconvalley',
  'audio.lofi.cassette',
  'x11.underground.90s'
];

export const PwaUploader: React.FC<PwaUploaderProps> = ({ onPublish, onGoToFeed }) => {
  const [deviceFrame, setDeviceFrame] = useState<'mobile' | 'pda' | 'desktop'>('desktop');
  const [selectedImage, setSelectedImage] = useState<string>(RETRO_SVGS.pixelWorkstation);
  const [activeFilter, setActiveFilter] = useState<RetroFilter>('crt');
  const [caption, setCaption] = useState<string>(':> Booted X11 on my workstation. Compiling my personal homepage feed over 28.8k dial-up connection.');
  const [mood, setMood] = useState<string>('[:> CODING IN THE DARK]');
  const [webring, setWebring] = useState<string>('unix.hackers.retro');
  const [location, setLocation] = useState<string>('Sparcstation // Node #4');
  const [authorHandle] = useState<string>('root@neogram');
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  
  // Publishing state
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [publishStep, setPublishStep] = useState<string>('');
  const [publishSuccess, setPublishSuccess] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    retroAudio.playShutter();
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      if (loadEvent.target?.result) {
        setSelectedImage(loadEvent.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const selectPresetSprite = (sprite: typeof PRESET_SPRITES[0]) => {
    retroAudio.playClick();
    setSelectedImage(sprite.src);
    setActiveFilter(sprite.defaultFilter);
  };

  const handlePublish = () => {
    retroAudio.playDialupBeep();
    setIsPublishing(true);
    setPublishStep(':> init_ppp_link /dev/ttyS0 --baud 28800');

    setTimeout(() => {
      setPublishStep(':> carrier detected: V.34 protocol negotiation... [OK]');
    }, 600);

    setTimeout(() => {
      setPublishStep(':> rasterizing chunky sprite buffer (pixel matrix)... [OK]');
    }, 1200);

    setTimeout(() => {
      setPublishStep(':> publishing record to /var/neogram/feed.db... [DONE]');
    }, 1800);

    setTimeout(() => {
      setIsPublishing(false);
      setPublishSuccess(true);
      retroAudio.playSuccess();

      const newPost: Post = {
        id: `post-${Date.now()}`,
        author: authorHandle,
        handle: ':> ' + authorHandle.split('@')[0],
        avatar: '👾',
        timestamp: '1996-10-19 ' + new Date().toLocaleTimeString(),
        imageSrc: selectedImage,
        filter: activeFilter,
        caption: caption || ':> surfin the digital frontier...',
        mood: mood,
        webring: webring,
        location: location || 'Cyberspace Node',
        likes: 1,
        radicals: 0,
        bookmarks: 0,
        comments: []
      };

      onPublish(newPost);
    }, 2400);
  };

  const getFilterStyle = (filter: RetroFilter): React.CSSProperties => {
    switch (filter) {
      case 'crt':
        return { filter: 'contrast(1.25) brightness(1.1) saturate(1.2)' };
      case 'vga':
        return { filter: 'contrast(1.8) saturate(1.7) brightness(0.95)' };
      case 'gameboy':
        return { filter: 'sepia(1) hue-rotate(50deg) saturate(3.5) contrast(1.4) brightness(0.9)' };
      case 'cyberpunk':
        return { filter: 'contrast(1.3) hue-rotate(180deg) saturate(2)' };
      case 'sepia':
        return { filter: 'sepia(0.85) contrast(1.15) brightness(0.95)' };
      case 'none':
      default:
        return {};
    }
  };

  return (
    <div className="py-6 px-3 sm:px-6">
      {/* Top Session Prompt Bar */}
      <div className="max-w-6xl mx-auto mb-6 bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] p-2.5 pixel-box flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 bg-[#39ff14] border border-black inline-block"></span>
          <span className="font-mono font-bold text-black dark:text-[#e6edf3]">
            terminal://user@neogram:~$ <span className="text-[#000080] dark:text-[#58a6ff]">./upload_pwa.sh</span>
          </span>
        </div>

        {/* Device Viewport Mode */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-700 dark:text-gray-400 font-mono text-[11px]">View Mode:</span>
          <button
            onClick={() => {
              retroAudio.playClick();
              setDeviceFrame('desktop');
            }}
            className={`pixel-btn text-xs py-1 px-2 ${deviceFrame === 'desktop' ? 'bg-black text-[#39ff14] dark:bg-[#58a6ff] dark:text-black font-bold' : ''}`}
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Split Studio</span>
          </button>
          <button
            onClick={() => {
              retroAudio.playClick();
              setDeviceFrame('mobile');
            }}
            className={`pixel-btn text-xs py-1 px-2 ${deviceFrame === 'mobile' ? 'bg-black text-[#39ff14] dark:bg-[#58a6ff] dark:text-black font-bold' : ''}`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Mobile Palm</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="max-w-6xl mx-auto">
        <div className={`grid gap-8 ${deviceFrame === 'desktop' ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1 max-w-xl mx-auto'}`}>
          
          {/* UPLOADER CONSOLE */}
          <div className={`${deviceFrame === 'desktop' ? 'lg:col-span-7' : 'w-full'}`}>
            <div className="bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] pixel-box p-1 text-black dark:text-[#e6edf3]">
              
              {/* Mac / Unix Pinstripe Titlebar */}
              <div className="bg-[#2a2c30] text-white px-3 py-1.5 flex items-center justify-between text-xs font-mono font-bold mb-3 select-none border-b-2 border-black">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 bg-white text-black border border-black flex items-center justify-center text-[10px]">■</span>
                  <span>neogram_capture_station.bin</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[#39ff14] font-mono">PID 429</span>
                </div>
              </div>

              <div className="p-3 sm:p-5 space-y-5">
                
                {/* 1. HUGE CHUNKY 8-BIT CAMERA UPLOAD BUTTON (Hero Upload Trigger) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span className="text-[#000080] dark:text-[#58a6ff]">:&gt;</span>
                      <span>Visual Capture Source</span>
                    </label>
                    <span className="text-[11px] font-mono text-gray-600 dark:text-gray-400">Drag &amp; Drop or Click</span>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {/* The Big Chunky Button with 8-bit Camera Sprite & Blinking Red LED */}
                  <button
                    type="button"
                    onClick={() => {
                      retroAudio.playShutter();
                      fileInputRef.current?.click();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOver(true);
                    }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                    className={`w-full p-6 sm:p-8 border-4 border-black dark:border-[#58a6ff] pixel-box transition-all text-left group cursor-pointer ${
                      isDragOver
                        ? 'bg-[#ffff00] text-black scale-[1.01]'
                        : 'bg-[#ede9df] dark:bg-[#0d1117] hover:bg-[#f6f2e8] dark:hover:bg-[#161b22]'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row items-center gap-6">
                      {/* Chunky 8-Bit Camera Sprite with Blinking Recording LED */}
                      <div className="w-24 h-24 shrink-0 p-1 bg-black/10 dark:bg-white/10 border-2 border-black dark:border-white">
                        <img
                          src={RETRO_SVGS.pixelCamera}
                          alt="8-bit Pixel Camera"
                          className="w-full h-full object-contain"
                        />
                      </div>

                      {/* Call to action typography */}
                      <div className="flex-1 text-center sm:text-left">
                        <div className="text-base sm:text-lg font-mono font-bold text-black dark:text-[#e6edf3] mb-1 flex items-center justify-center sm:justify-start gap-2">
                          <span className="text-[#ff0033] animate-pulse">●</span>
                          <span>SNAP PHOTO OR UPLOAD IMAGE</span>
                        </div>
                        <p className="text-xs font-mono text-gray-700 dark:text-gray-300 mb-2">
                          Click to browse device photos, camera roll, or drop files directly here.
                        </p>
                        <div className="inline-flex items-center gap-2 text-[11px] font-mono font-bold text-[#000080] dark:text-[#58a6ff] bg-black/5 dark:bg-white/10 px-2 py-0.5 border border-current">
                          <span>:&gt; READY FOR CAPTURE</span>
                          <span className="blinking-cursor">_</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Sample Sprite Picker (Convenience fallback) */}
                  <div className="mt-3 pt-2 border-t-2 border-dashed border-gray-400 dark:border-gray-700">
                    <span className="text-[11px] font-mono text-gray-700 dark:text-gray-400 block mb-2">
                      Or select an animated 8-bit sample sprite:
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {PRESET_SPRITES.map((sprite, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => selectPresetSprite(sprite)}
                          className={`pixel-btn text-xs py-1.5 px-2 flex items-center justify-center gap-1.5 ${
                            selectedImage === sprite.src ? 'bg-black text-[#39ff14] dark:bg-[#58a6ff] dark:text-black font-bold' : ''
                          }`}
                        >
                          <span className="truncate">{sprite.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 2. Retro Dither & CRT Shader Matrix */}
                <div>
                  <label className="text-xs font-mono font-bold uppercase tracking-wider block mb-2 flex items-center gap-1.5">
                    <span className="text-[#000080] dark:text-[#58a6ff]">:&gt;</span>
                    <span>Retro Hardware Shaders</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {FILTER_PRESETS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          retroAudio.playClick();
                          setActiveFilter(f.id);
                        }}
                        className={`p-2 text-left border-3 pixel-box transition-all ${
                          activeFilter === f.id
                            ? 'bg-black text-[#39ff14] border-black font-bold dark:bg-[#58a6ff] dark:text-black'
                            : 'bg-white dark:bg-[#0d1117] text-black dark:text-[#e6edf3] border-black dark:border-[#384252]'
                        }`}
                      >
                        <div className="text-xs font-mono font-bold flex items-center justify-between">
                          <span>{f.name}</span>
                          {activeFilter === f.id && <span>✓</span>}
                        </div>
                        <div className={`text-[10px] mt-0.5 font-mono ${activeFilter === f.id ? 'opacity-90' : 'text-gray-600 dark:text-gray-400'}`}>
                          {f.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Caption with System Prompt :> */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span className="text-[#000080] dark:text-[#58a6ff]">:&gt;</span>
                      <span>Caption Message Log</span>
                    </label>
                    <span className="text-[11px] font-mono text-gray-600 dark:text-gray-400">
                      {caption.length} / 280 bytes
                    </span>
                  </div>
                  <div className="relative">
                    <textarea
                      rows={3}
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder=":> enter your thoughts into the cyberspace stream..."
                      className="w-full p-2.5 text-xs font-mono border-3 border-black dark:border-[#384252] bg-white dark:bg-[#0d1117] text-black dark:text-[#e6edf3] focus:outline-none focus:border-[#000080] dark:focus:border-[#58a6ff]"
                    />
                  </div>
                </div>

                {/* 4. Mood & Webring Tagging */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-mono font-bold uppercase tracking-wider block mb-1">
                      Mood Tag
                    </label>
                    <select
                      value={mood}
                      onChange={(e) => {
                        retroAudio.playClick();
                        setMood(e.target.value);
                      }}
                      className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#0d1117] text-black dark:text-[#e6edf3] cursor-pointer"
                    >
                      {MOODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-mono font-bold uppercase tracking-wider block mb-1">
                      Webring Network
                    </label>
                    <select
                      value={webring}
                      onChange={(e) => {
                        retroAudio.playClick();
                        setWebring(e.target.value);
                      }}
                      className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#0d1117] text-black dark:text-[#e6edf3] cursor-pointer"
                    >
                      {WEBRINGS.map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 5. Terminal Location */}
                <div>
                  <label className="text-xs font-mono font-bold uppercase tracking-wider block mb-1">
                    Node Location
                  </label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full p-2 text-xs font-mono border-2 border-black dark:border-[#384252] bg-white dark:bg-[#0d1117] text-black dark:text-[#e6edf3]"
                  />
                </div>

                {/* Publish Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={isPublishing}
                    className="w-full pixel-btn bg-[#39ff14] text-black dark:bg-[#58a6ff] dark:text-black font-bold py-3 px-4 text-sm flex items-center justify-center gap-2 border-3 border-black hover:brightness-105 active:translate-y-0.5"
                  >
                    {isPublishing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>TRANSMITTING PACKETS VIA DIAL-UP...</span>
                      </>
                    ) : (
                      <>
                        <Wifi className="w-4 h-4" />
                        <span>:&gt; PUBLISH TO NEOGRAM STATIC FEED</span>
                      </>
                    )}
                  </button>
                </div>

              </div>
            </div>
          </div>

          {/* LIVE EMBED PREVIEW */}
          <div className={`${deviceFrame === 'desktop' ? 'lg:col-span-5' : 'w-full'}`}>
            <div className="bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] p-1 pixel-box text-black dark:text-[#e6edf3]">
              
              {/* Header */}
              <div className="bg-[#2a2c30] text-white px-3 py-1.5 flex items-center justify-between text-xs font-mono font-bold mb-3 border-b-2 border-black">
                <span>:&gt; live_feed_preview.out</span>
                <span className="text-[#39ff14] font-mono text-[10px]">SYNCED</span>
              </div>

              {/* The Live Rendered Card */}
              <div className="p-3">
                <div className="neogram-post bg-white dark:bg-[#0d1117] border-3 border-black dark:border-[#384252]">
                  <div className="neogram-post__header">
                    <div className="neogram-post__user">
                      <span className="neogram-post__avatar bg-black text-[#39ff14] flex items-center justify-center font-bold text-xs">
                        👾
                      </span>
                      <div>
                        <div className="text-xs font-mono font-bold">{authorHandle}</div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400">{location}</div>
                      </div>
                    </div>
                    <span className="neogram-post__timestamp font-mono text-[11px]">JUST NOW</span>
                  </div>

                  {/* Rendered Media with Blinking Animations */}
                  <div className="neogram-post__media relative border-2 border-black">
                    <img
                      src={selectedImage}
                      alt="Media preview"
                      style={getFilterStyle(activeFilter)}
                      className={`w-full aspect-square object-cover ${activeFilter === 'crt' ? 'crt-scanlines' : ''}`}
                    />
                    {activeFilter === 'crt' && <div className="absolute inset-0 crt-scanlines pointer-events-none"></div>}
                    {activeFilter === 'vga' && <div className="absolute inset-0 retro-dither pointer-events-none opacity-40"></div>}
                  </div>

                  <div className="neogram-post__caption font-mono">
                    {caption || ':> (no caption logged)'}
                  </div>

                  <div className="neogram-post__tags font-mono">
                    <span className="font-bold text-[#000080] dark:text-[#58a6ff]">{mood}</span>
                    <span className="text-gray-600 dark:text-gray-400">#{webring}</span>
                  </div>

                  <div className="neogram-post__actions">
                    <button className="neogram-button text-[11px]">
                      <span>👍 COOL!</span>
                      <span>(1)</span>
                    </button>
                    <button className="neogram-button text-[11px]">
                      <span>⚡ RAD!</span>
                      <span>(0)</span>
                    </button>
                    <button className="neogram-button text-[11px]">
                      <span>💬 0</span>
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Terminal Transmission Dialog */}
      {isPublishing && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161b22] border-4 border-[#39ff14] max-w-lg w-full p-1 pixel-box text-[#39ff14] font-mono">
            <div className="bg-black px-3 py-1.5 text-xs font-bold flex items-center justify-between border-b-2 border-[#39ff14]">
              <span>TERMINAL: DIAL-UP DISPATCH</span>
              <span>28800 V.34</span>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-xs space-y-1.5">
                <div>[NEO-NET] Initiating socket handshake...</div>
                <div className="text-white font-bold">{publishStep}</div>
              </div>

              {/* Chunky Progress Bar */}
              <div className="w-full bg-black border-2 border-[#39ff14] p-1 h-6">
                <div className="h-full bg-[#39ff14] w-3/4 animate-pulse"></div>
              </div>

              <div className="text-[11px] text-gray-400 text-center">
                Writing packet bytes to decentralized Neocities feed cache...
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Publish Success Toast */}
      {publishSuccess && (
        <div className="fixed bottom-8 right-8 z-50 max-w-sm bg-[#ffff00] border-4 border-black p-3.5 pixel-box text-black">
          <div className="flex items-start gap-2.5">
            <CheckCircle className="w-5 h-5 text-black shrink-0 mt-0.5" />
            <div className="text-xs font-mono">
              <div className="font-bold text-sm mb-1">:&gt; POST BROADCAST COMPLETE!</div>
              <p className="text-gray-900 text-[11px] mb-2.5">
                Successfully written to Neogram feed buffer and synced to static embed.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    retroAudio.playClick();
                    setPublishSuccess(false);
                    onGoToFeed();
                  }}
                  className="pixel-btn text-xs bg-black text-[#39ff14] font-bold"
                >
                  View in Feed →
                </button>
                <button
                  onClick={() => setPublishSuccess(false)}
                  className="pixel-btn text-xs bg-white text-black"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
