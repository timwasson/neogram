import React, { useState } from 'react';
import { ThumbsUp, Zap, Bookmark, MessageSquare, Send, Globe, Code, ArrowLeft, ExternalLink } from 'lucide-react';
import { Post, ThemeSkin } from '../types';
import { retroAudio } from '../utils/audio';

interface PhotoGalleryProps {
  posts: Post[];
  onAddComment: (postId: string, author: string, text: string) => Promise<void> | void;
  onLikePost: (postId: string) => void;
  onRadicalPost: (postId: string) => void;
  onBookmarkPost: (postId: string) => void;
  openEmbedModal: () => void;
}

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({
  posts,
  onAddComment,
  onLikePost,
  onRadicalPost,
  onBookmarkPost,
  openEmbedModal,
}) => {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedSkin, setSelectedSkin] = useState<ThemeSkin>('win95');
  const [commentAuthor, setCommentAuthor] = useState<string>('guest_surfer');
  const [commentText, setCommentText] = useState<string>('');
  const [isSubmittingComment, setIsSubmittingComment] = useState<boolean>(false);

  const selectedPost = posts.find((p) => p.id === selectedPostId);

  const handleSelectPost = (postId: string) => {
    retroAudio.playClick();
    setSelectedPostId(postId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToGrid = () => {
    retroAudio.playClick();
    setSelectedPostId(null);
  };

  const handleSkinChange = (skin: ThemeSkin) => {
    retroAudio.playClick();
    setSelectedSkin(skin);
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || !selectedPostId) return;

    setIsSubmittingComment(true);
    try {
      await onAddComment(selectedPostId, commentAuthor || 'guest_surfer', commentText.trim());
      setCommentText('');
      retroAudio.playSuccess();
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const getSkinThemeClass = (skin: ThemeSkin): string => {
    switch (skin) {
      case 'cyberpunk':
        return 'theme-cyberpunk bg-[#0d0628] text-[#00ffff]';
      case 'geocities':
        return 'theme-geocities bg-[#fffaf0] text-[#330033]';
      case 'matrix':
        return 'theme-matrix bg-[#031405] text-[#00ff66]';
      case 'win95':
      default:
        return 'bg-[#dcd8d0] dark:bg-[#161b22] text-black dark:text-[#e6edf3]';
    }
  };

  const getFilterStyle = (filter: string): React.CSSProperties => {
    switch (filter) {
      case 'vga':
        return { filter: 'contrast(1.5) saturate(1.4) brightness(1.1)' };
      case 'gameboy':
        return { filter: 'grayscale(1) sepia(1) hue-rotate(60deg) saturate(3.5) contrast(1.4)' };
      case 'cyberpunk':
        return { filter: 'hue-rotate(280deg) saturate(2) contrast(1.25)' };
      case 'sepia':
        return { filter: 'sepia(0.85) contrast(1.15) brightness(0.95)' };
      case 'crt':
        return { filter: 'contrast(1.15) brightness(1.05) saturate(1.2)' };
      case 'none':
      default:
        return { filter: 'none' };
    }
  };

  return (
    <div className="py-6 px-3 sm:px-6">
      {/* 1. Simulated Static Host Header Bar */}
      <div className="max-w-6xl mx-auto mb-6 bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] p-3 pixel-box">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2 flex-wrap">
            <Globe className="w-4 h-4 text-[#000080] dark:text-[#58a6ff]" />
            <span className="font-bold">STATIC GALLERY HOST:</span>
            <span className="bg-white dark:bg-[#0d1117] px-2 py-0.5 border-2 border-black dark:border-[#58a6ff] text-[#000080] dark:text-[#58a6ff] font-bold">
              http://cyber_phantom.neocities.org/gallery.html
            </span>
            <span className="text-[#39ff14] text-[11px] font-bold ml-1">● ONLINE</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Direct Link to Creator Studio on Port 4000 */}
            <a
              href="http://localhost:4000/"
              className="pixel-btn text-xs bg-[#ffff00] text-black font-bold flex items-center gap-1.5"
              onClick={() => retroAudio.playClick()}
            >
              <span>🔑</span>
              <span>Creator Studio / Upload (Port 4000)</span>
              <ExternalLink className="w-3 h-3 ml-0.5" />
            </a>

            {/* Embed Snippets Modal */}
            <button
              onClick={() => {
                retroAudio.playClick();
                openEmbedModal();
              }}
              className="pixel-btn text-xs bg-[#dcd8d0] dark:bg-[#21262d] text-black dark:text-white font-bold flex items-center gap-1"
            >
              <Code className="w-3.5 h-3.5" />
              <span>Embed</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Gallery Container (Mac/Unix/Neocities Retro Homage) */}
      <div className="max-w-6xl mx-auto bg-[#1a1226] border-4 border-black p-4 sm:p-7 pixel-box text-white relative">
        {/* Banner with Pinstripes */}
        <div className="border-4 border-[#ffff00] bg-[#000080] p-4 text-center mb-6 pixel-box">
          <div className="text-xl sm:text-3xl font-extrabold text-[#ffff00] tracking-widest uppercase mb-1 font-mono">
            ⚡ CYBER PHANTOM'S STATIC PHOTO LAIR ⚡
          </div>
          <div className="text-xs sm:text-sm text-[#00ffff] font-mono">
            LIVE PHOTO STREAM · POWERED BY NEOGRAM BACKEND (PORT 4000) · 800x600 READY
          </div>
        </div>

        {/* Skin Switcher Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs font-mono bg-black/60 p-2 border-2 border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-yellow-400 font-bold">GALLERY SKINS:</span>
            {(['win95', 'cyberpunk', 'geocities', 'matrix'] as ThemeSkin[]).map((skin) => (
              <button
                key={skin}
                onClick={() => handleSkinChange(skin)}
                className={`px-2 py-0.5 border text-[11px] font-bold uppercase transition-transform active:translate-y-0.5 ${
                  selectedSkin === skin
                    ? 'bg-[#ffff00] text-black border-white shadow-[1px_1px_0px_#fff]'
                    : 'bg-[#2a2c30] text-gray-300 border-gray-600 hover:border-gray-400'
                }`}
              >
                {skin}
              </button>
            ))}
          </div>

          <div className="text-[11px] text-gray-400">
            {posts.length} PHOTOS BROADCAST FROM POSTGRESQL NODE
          </div>
        </div>

        {/* -------------------------------------------------------------
            VIEW A: DEDICATED PHOTO & COMMENTS PAGE
            ------------------------------------------------------------- */}
        {selectedPost ? (
          <div className={`p-4 sm:p-6 border-4 border-black pixel-box ${getSkinThemeClass(selectedSkin)}`}>
            {/* Back Button */}
            <div className="mb-4">
              <button
                onClick={handleBackToGrid}
                className="pixel-btn bg-[#ffff00] text-black font-bold text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>← BACK TO PHOTO GALLERY GRID</span>
              </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
              {/* Photo Viewport */}
              <div className="lg:w-7/12 flex flex-col gap-3">
                <div className="window-header bg-[#2a2c30] text-white px-3 py-1.5 text-xs font-bold flex items-center justify-between border-2 border-black">
                  <span>:&gt; {selectedPost.id}.bitmap // SHADER: {selectedPost.filter.toUpperCase()}</span>
                  <span className="text-[#39ff14]">100% BITMAP</span>
                </div>

                <div className="bg-black border-4 border-black pixel-box p-1 relative overflow-hidden flex items-center justify-center min-h-[360px] crt-scanlines">
                  <img
                    src={selectedPost.imageSrc}
                    alt={selectedPost.caption}
                    className="max-h-[460px] max-w-full object-contain pixelated"
                    style={getFilterStyle(selectedPost.filter)}
                  />
                </div>

                {/* Tags row */}
                <div className="flex flex-wrap gap-2 text-xs font-mono">
                  <span className="bg-[#285577] text-white px-2 py-0.5 border border-black font-bold">
                    {selectedPost.mood}
                  </span>
                  <span className="bg-[#000080] text-[#00ffff] px-2 py-0.5 border border-black font-bold">
                    ring: {selectedPost.webring}
                  </span>
                  <span className="bg-[#333333] text-gray-200 px-2 py-0.5 border border-black font-bold">
                    loc: {selectedPost.location}
                  </span>
                </div>
              </div>

              {/* Photo Details & Comments Ledger */}
              <div className="lg:w-5/12 flex flex-col gap-4">
                {/* Author & Timestamp */}
                <div className="border-b-2 border-current pb-3 font-mono">
                  <div className="flex items-center justify-between text-xs font-bold mb-1">
                    <span className="text-base text-[#000080] dark:text-[#58a6ff]">
                      @{selectedPost.author}
                    </span>
                    <span className="text-[11px] opacity-75">{selectedPost.timestamp}</span>
                  </div>
                  <p className="text-xs sm:text-sm leading-relaxed mt-2">{selectedPost.caption}</p>
                </div>

                {/* Reaction Actions Bar */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => {
                      retroAudio.playClick();
                      onLikePost(selectedPost.id);
                    }}
                    className={`pixel-btn text-xs py-1 px-3 font-bold flex items-center gap-1.5 ${
                      selectedPost.userLiked ? 'bg-[#ff3366] text-white' : 'bg-[#dcd8d0] dark:bg-[#21262d] text-black dark:text-white'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>LIKE ({selectedPost.likes})</span>
                  </button>

                  <button
                    onClick={() => {
                      retroAudio.playClick();
                      onRadicalPost(selectedPost.id);
                    }}
                    className={`pixel-btn text-xs py-1 px-3 font-bold flex items-center gap-1.5 ${
                      selectedPost.userRadical ? 'bg-[#ffcc00] text-black' : 'bg-[#dcd8d0] dark:bg-[#21262d] text-black dark:text-white'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>RADICAL ({selectedPost.radicals})</span>
                  </button>

                  <button
                    onClick={() => {
                      retroAudio.playClick();
                      onBookmarkPost(selectedPost.id);
                    }}
                    className="pixel-btn text-xs py-1 px-3 font-bold bg-[#dcd8d0] dark:bg-[#21262d] text-black dark:text-white flex items-center gap-1.5"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    <span>BOOKMARK ({selectedPost.bookmarks})</span>
                  </button>
                </div>

                {/* Centralized Comments Ledger */}
                <div className="flex-1 flex flex-col mt-2">
                  <div className="window-header bg-[#000080] text-white px-3 py-1 text-xs font-bold flex items-center justify-between border-2 border-black">
                    <span className="flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>CENTRALIZED COMMENT LEDGER ({selectedPost.comments.length})</span>
                    </span>
                    <span className="text-[#39ff14] text-[10px]">SYNCED // PORT 4000</span>
                  </div>

                  {/* Comments scroll box */}
                  <div className="bg-white dark:bg-[#0d1117] border-2 border-black p-3 space-y-2.5 max-h-56 overflow-y-auto font-mono text-xs text-black dark:text-gray-200">
                    {selectedPost.comments.length === 0 ? (
                      <div className="text-gray-500 italic py-3 text-center text-xs">
                        [:&gt; No visitor comments recorded on ledger yet. Be the first to leave your mark.]
                      </div>
                    ) : (
                      selectedPost.comments.map((comment) => (
                        <div key={comment.id} className="border-b border-gray-300 dark:border-gray-800 pb-2">
                          <div className="flex items-center justify-between text-[11px] font-bold text-[#000080] dark:text-[#58a6ff]">
                            <span>
                              {comment.avatar} @{comment.author}
                            </span>
                            <span className="text-gray-500 text-[10px]">{comment.timestamp}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-800 dark:text-gray-300">{comment.text}</p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment Form */}
                  <form onSubmit={handleCommentSubmit} className="mt-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commentAuthor}
                        onChange={(e) => setCommentAuthor(e.target.value)}
                        placeholder="Visitor Handle"
                        className="w-1/3 px-2 py-1 text-xs font-mono font-bold bg-white dark:bg-[#0d1117] text-black dark:text-white border-2 border-black outline-none"
                      />
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Write a comment on this photo..."
                        required
                        className="flex-1 px-2 py-1 text-xs font-mono bg-white dark:bg-[#0d1117] text-black dark:text-white border-2 border-black outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmittingComment}
                      className="pixel-btn bg-[#39ff14] text-black font-bold text-xs py-1.5 flex items-center justify-center gap-1.5"
                    >
                      <Send className="w-3 h-3" />
                      <span>{isSubmittingComment ? 'TRANSMITTING...' : 'COMMIT COMMENT TO LEDGER :>'}</span>
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* -------------------------------------------------------------
              VIEW B: PHOTO GALLERY GRID
              ------------------------------------------------------------- */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <div
                key={post.id}
                className={`border-4 border-black pixel-box flex flex-col transition-transform hover:-translate-y-1 ${getSkinThemeClass(
                  selectedSkin
                )}`}
              >
                {/* Card Titlebar */}
                <div className="bg-[#2a2c30] text-white px-2.5 py-1 text-xs font-mono font-bold flex items-center justify-between border-b-2 border-black">
                  <span className="truncate">@{post.author}</span>
                  <span className="text-[#39ff14] text-[10px] shrink-0 font-bold uppercase">
                    {post.filter}
                  </span>
                </div>

                {/* Photo Thumbnail Viewport */}
                <div
                  className="bg-black border-b-3 border-black p-1 h-56 flex items-center justify-center cursor-pointer overflow-hidden relative group"
                  onClick={() => handleSelectPost(post.id)}
                >
                  <img
                    src={post.imageSrc}
                    alt={post.caption}
                    className="max-h-full max-w-full object-contain pixelated group-hover:scale-105 transition-transform duration-150"
                    style={getFilterStyle(post.filter)}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <span className="pixel-btn bg-[#ffff00] text-black font-bold text-xs py-1 px-2.5">
                      👁️ VIEW FULL PHOTO
                    </span>
                  </div>
                </div>

                {/* Content Details */}
                <div className="p-3.5 flex-1 flex flex-col justify-between font-mono">
                  <div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      {post.location} · {post.timestamp.split(' ')[0]}
                    </div>
                    <p className="text-xs line-clamp-2 mb-2 leading-relaxed font-normal">
                      {post.caption}
                    </p>
                  </div>

                  <div>
                    {/* Mood & Webring Badge */}
                    <div className="flex items-center gap-1 mb-3 text-[10px] overflow-hidden">
                      <span className="bg-black text-[#39ff14] px-1.5 py-0.5 border border-black truncate">
                        {post.mood}
                      </span>
                    </div>

                    {/* Footer Metrics & Detail Trigger */}
                    <div className="pt-2 border-t border-gray-300 dark:border-gray-800 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3 text-[11px] font-bold">
                        <span className="flex items-center gap-1">
                          <span>❤️</span>
                          <span>{post.likes}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span>💬</span>
                          <span>{post.comments.length}</span>
                        </span>
                      </div>

                      <button
                        onClick={() => handleSelectPost(post.id)}
                        className="pixel-btn text-[11px] py-0.5 px-2 font-bold bg-[#ffff00] text-black"
                      >
                        <span>VIEW &amp; COMMENT :&gt;</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
