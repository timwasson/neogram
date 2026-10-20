import React, { useState } from 'react';
import { ThumbsUp, Zap, Bookmark, MessageSquare, Send, Globe, Code } from 'lucide-react';
import { Post, ThemeSkin } from '../types';
import { retroAudio } from '../utils/audio';

interface FeedEmbedProps {
  posts: Post[];
  onAddComment: (postId: string, author: string, text: string) => void;
  onLikePost: (postId: string) => void;
  onRadicalPost: (postId: string) => void;
  onBookmarkPost: (postId: string) => void;
  openEmbedModal: () => void;
}

export const FeedEmbed: React.FC<FeedEmbedProps> = ({
  posts,
  onAddComment,
  onLikePost,
  onRadicalPost,
  onBookmarkPost,
  openEmbedModal
}) => {
  const [selectedSkin, setSelectedSkin] = useState<ThemeSkin>('win95');
  const [activeCommentPostId, setActiveCommentPostId] = useState<string | null>(null);
  const [commentAuthor, setCommentAuthor] = useState<string>('guest_surfer');
  const [commentText, setCommentText] = useState<string>('');

  const handleSkinChange = (skin: ThemeSkin) => {
    retroAudio.playClick();
    setSelectedSkin(skin);
  };

  const handleCommentSubmit = (postId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    retroAudio.playSuccess();
    onAddComment(postId, commentAuthor || 'guest_user', commentText.trim());
    setCommentText('');
    setActiveCommentPostId(null);
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

  return (
    <div className="py-6 px-3 sm:px-6">
      {/* Simulated Host Site Browser Bar */}
      <div className="max-w-5xl mx-auto mb-6 bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] p-2.5 pixel-box">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#000080] dark:text-[#58a6ff]" />
            <span className="font-bold">SIMULATED STATIC HOST:</span>
            <span className="bg-white dark:bg-[#0d1117] px-2 py-0.5 border-2 border-black dark:border-[#58a6ff] text-[#000080] dark:text-[#58a6ff]">
              http://cyber_phantom.neocities.org/index.html
            </span>
          </div>

          <button
            onClick={() => {
              retroAudio.playClick();
              openEmbedModal();
            }}
            className="pixel-btn text-xs bg-[#ffff00] text-black font-bold"
          >
            <Code className="w-3.5 h-3.5" />
            <span>:&gt; Copy Embed Snippet</span>
          </button>
        </div>
      </div>

      {/* The Host Web Page (Mac/Unix/Neocities Retro Homage) */}
      <div className="max-w-5xl mx-auto bg-[#1a1226] border-4 border-black p-4 sm:p-7 pixel-box text-white relative">
        
        {/* Host Page Header Banner with Pinstripes */}
        <div className="border-4 border-[#ffff00] bg-[#000080] p-4 text-center mb-6 pixel-box">
          <div className="text-xl sm:text-3xl font-extrabold text-[#ffff00] tracking-widest uppercase mb-1 font-mono">
            ⚡ CYBER PHANTOM'S UNIX LAIR ⚡
          </div>
          <div className="text-xs sm:text-sm text-[#00ffff] font-mono">
            EST. OCT 1996 · HOSTED ON NEOCITIES // BEST WITH LYNX OR NETSCAPE 800x600
          </div>
        </div>

        {/* Hazard Banner */}
        <div className="mb-6 border-3 border-black">
          <div className="bg-[#ffcc00] text-black font-mono font-bold text-xs py-1 text-center tracking-widest">
            ⚠️ SITE UNDER HEAVY EXPERIMENTAL CONSTRUCTION ⚠️
          </div>
        </div>

        {/* 88x31 Micro Buttons Row */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          <div className="neogram-badge bg-black text-[#00ffcc] border-2 border-[#00ffcc]">
            NETSCAPE 4.0
          </div>
          <div className="neogram-badge bg-[#000080] text-white border-2 border-white">
            VI / EMACS
          </div>
          <div className="neogram-badge bg-[#ff00ff] text-white border-2 border-black">
            800x600 RES
          </div>
          <div className="neogram-badge bg-[#00ff00] text-black border-2 border-black">
            NO COOKIES
          </div>
          <div className="neogram-badge bg-[#ffff00] text-black border-2 border-black">
            NEOGRAM FEED
          </div>
        </div>

        {/* Webring Navigation Bar */}
        <div className="bg-[#26183d] border-3 border-[#00ffff] p-3 mb-8 text-center text-xs font-mono">
          <div className="font-bold text-[#ffff00] mb-2">
            [:&gt; RETRO WEBRING HUB #42 OF 128 SITES]
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => retroAudio.playClick()}
              className="px-2.5 py-1 bg-black text-[#00ffff] border-2 border-[#00ffff] text-xs hover:bg-[#00ffff] hover:text-black font-bold"
            >
              &lt;&lt; PREV
            </button>
            <button
              onClick={() => retroAudio.playClick()}
              className="px-2.5 py-1 bg-black text-[#ff00ff] border-2 border-[#ff00ff] text-xs hover:bg-[#ff00ff] hover:text-black font-bold"
            >
              [ RANDOM ]
            </button>
            <button
              onClick={() => retroAudio.playClick()}
              className="px-2.5 py-1 bg-black text-[#00ffff] border-2 border-[#00ffff] text-xs hover:bg-[#00ffff] hover:text-black font-bold"
            >
              NEXT &gt;&gt;
            </button>
          </div>
        </div>

        {/* SKIN SWITCHER BAR */}
        <div className="bg-[#10091d] border-3 border-white p-3 mb-6 font-mono">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <span className="font-bold text-[#ffff00]">LIVE EMBED SKIN: </span>
              <span className="text-gray-300">Override via custom stylesheet parameter</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => handleSkinChange('win95')}
                className={`pixel-btn text-xs py-1 px-2 ${selectedSkin === 'win95' ? 'bg-[#000080] text-white font-bold' : 'bg-[#dcd8d0] text-black'}`}
              >
                Workstation Classic
              </button>
              <button
                onClick={() => handleSkinChange('cyberpunk')}
                className={`pixel-btn text-xs py-1 px-2 ${selectedSkin === 'cyberpunk' ? 'bg-[#ff007f] text-white font-bold' : 'bg-[#0d0628] text-[#00ffff]'}`}
              >
                Cyberpunk Neon
              </button>
              <button
                onClick={() => handleSkinChange('geocities')}
                className={`pixel-btn text-xs py-1 px-2 ${selectedSkin === 'geocities' ? 'bg-[#ff00aa] text-white font-bold' : 'bg-[#fff0f5] text-black'}`}
              >
                Geocities Sunset
              </button>
              <button
                onClick={() => handleSkinChange('matrix')}
                className={`pixel-btn text-xs py-1 px-2 ${selectedSkin === 'matrix' ? 'bg-[#00ff66] text-black font-bold' : 'bg-[#031405] text-[#00ff66]'}`}
              >
                Y2K Matrix
              </button>
            </div>
          </div>
        </div>

        {/* THE EMBEDDED NEOGRAM FEED */}
        <div className="border-4 border-dashed border-[#00ffff] p-3 sm:p-5 relative">
          <div className="absolute -top-3.5 left-4 bg-black px-2 text-[11px] font-mono text-[#00ffff] border-2 border-[#00ffff]">
            &lt;iframe class="neogram-feed-iframe" src="..."&gt;
          </div>

          <div className={`p-4 sm:p-6 border-4 border-black ${getSkinThemeClass(selectedSkin)}`}>
            
            {/* Feed Header */}
            <div className="border-b-3 border-current pb-3 mb-6 flex flex-wrap items-center justify-between gap-3 font-mono">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-black text-[#39ff14] border-2 border-current flex items-center justify-center text-xl font-bold">
                  👾
                </div>
                <div>
                  <div className="font-bold text-base tracking-wide">CYBER_PHANTOM'S NEOGRAM LOG</div>
                  <div className="text-xs opacity-80">:&gt; connection 28.8k baud · Netscape / Lynx</div>
                </div>
              </div>

              {/* Feed Stats (Clean unboxed typography) */}
              <div className="flex items-center gap-2 text-xs opacity-90">
                <span>Posts: {posts.length}</span>
                <span aria-hidden="true">·</span>
                <span>Subscribers: 1,337</span>
                <span aria-hidden="true">·</span>
                <span>Rate: 14.4 KB/s</span>
              </div>
            </div>

            {/* Posts List using `.neogram-feed` */}
            <div className="neogram-feed">
              {posts.map((post) => (
                <article key={post.id} className="neogram-post pixel-box">
                  
                  {/* Post Header */}
                  <div className="neogram-post__header font-mono">
                    <div className="neogram-post__user">
                      <span className="neogram-post__avatar bg-black text-[#39ff14] flex items-center justify-center text-sm border-2 border-black">
                        {post.avatar}
                      </span>
                      <div>
                        <div className="text-sm font-bold">{post.author}</div>
                        <div className="text-[11px] opacity-75">{post.location}</div>
                      </div>
                    </div>
                    <div className="neogram-post__timestamp font-mono">
                      {post.timestamp}
                    </div>
                  </div>

                  {/* Post Media with chunky borders & live animations */}
                  <div className="neogram-post__media relative border-3 border-black">
                    <img
                      src={post.imageSrc}
                      alt={post.caption}
                      className="w-full aspect-square max-h-[460px] object-cover"
                    />
                    {post.filter === 'crt' && <div className="absolute inset-0 crt-scanlines pointer-events-none"></div>}
                    {post.filter === 'vga' && <div className="absolute inset-0 retro-dither pointer-events-none opacity-40"></div>}
                  </div>

                  {/* Caption */}
                  <div className="neogram-post__caption font-mono">
                    <p className="whitespace-pre-wrap">{post.caption}</p>
                  </div>

                  {/* Tags */}
                  <div className="neogram-post__tags font-mono">
                    <span className="font-bold">{post.mood}</span>
                    <span className="opacity-80">#{post.webring}</span>
                  </div>

                  {/* Actions */}
                  <div className="neogram-post__actions font-mono">
                    <button
                      onClick={() => {
                        retroAudio.playClick();
                        onLikePost(post.id);
                      }}
                      className={`neogram-button ${post.userLiked ? 'neogram-button--primary' : ''}`}
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span>COOL!</span>
                      <span>({post.likes})</span>
                    </button>

                    <button
                      onClick={() => {
                        retroAudio.playCounterTick();
                        onRadicalPost(post.id);
                      }}
                      className={`neogram-button ${post.userRadical ? 'neogram-button--primary' : ''}`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>RADICAL!</span>
                      <span>({post.radicals})</span>
                    </button>

                    <button
                      onClick={() => {
                        retroAudio.playClick();
                        onBookmarkPost(post.id);
                      }}
                      className="neogram-button"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      <span>BOOKMARK</span>
                      <span>({post.bookmarks})</span>
                    </button>

                    <button
                      onClick={() => {
                        retroAudio.playClick();
                        setActiveCommentPostId(activeCommentPostId === post.id ? null : post.id);
                      }}
                      className="neogram-button ml-auto"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>COMMENTS ({post.comments.length})</span>
                    </button>
                  </div>

                  {/* Comments Section */}
                  {post.comments.length > 0 && (
                    <div className="mt-4 pt-3 border-t-2 border-dashed border-current space-y-2 font-mono">
                      <div className="text-xs font-bold uppercase tracking-wider">
                        Public Log Responses:
                      </div>
                      {post.comments.map((comment) => (
                        <div
                          key={comment.id}
                          className="neogram-comment p-2.5 border-2 border-current bg-black/10 dark:bg-white/5 text-xs"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="neogram-comment__author font-bold flex items-center gap-1.5">
                              <span>{comment.avatar}</span>
                              <span>{comment.author}</span>
                            </span>
                            <span className="text-[10px] opacity-75">{comment.timestamp}</span>
                          </div>
                          <div className="neogram-comment__text">
                            {comment.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add Comment Drawer */}
                  {activeCommentPostId === post.id && (
                    <form
                      onSubmit={(e) => handleCommentSubmit(post.id, e)}
                      className="mt-4 p-3 border-2 border-current bg-black/10 dark:bg-white/5 space-y-2.5 text-xs font-mono"
                    >
                      <div className="font-bold text-xs uppercase flex items-center justify-between">
                        <span>Leave a comment on this post:</span>
                        <button
                          type="button"
                          onClick={() => setActiveCommentPostId(null)}
                          className="opacity-75 hover:opacity-100"
                        >
                          [Close ✕]
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] mb-0.5">Handle:</label>
                          <input
                            type="text"
                            value={commentAuthor}
                            onChange={(e) => setCommentAuthor(e.target.value)}
                            className="w-full p-1.5 text-black dark:text-white bg-white dark:bg-[#0d1117] border-2 border-current text-xs font-mono"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] mb-0.5">Message:</label>
                          <input
                            type="text"
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            placeholder=":> Great sprite setup! Bookmarking..."
                            className="w-full p-1.5 text-black dark:text-white bg-white dark:bg-[#0d1117] border-2 border-current text-xs font-mono"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        className="pixel-btn bg-[#000080] text-white font-bold py-1 px-3 text-xs flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        <span>Post Comment</span>
                      </button>
                    </form>
                  )}

                </article>
              ))}
            </div>

            {/* Embed Footer */}
            <div className="mt-8 pt-4 border-t-3 border-current text-center text-xs opacity-80 font-mono">
              ⚡ POWERED BY NEOGRAM PROTOCOL // STATIC WEB READY // NO COOKIES OR TRACKERS ⚡
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
