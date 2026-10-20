import React, { useState, useEffect } from 'react';
import { TopNav } from './components/TopNav';
import { PhotoGallery } from './components/PhotoGallery';
import { RetroWidgets } from './components/RetroWidgets';
import { EmbedModal } from './components/EmbedModal';
import { Post, GuestbookEntry } from './types';
import { INITIAL_POSTS, INITIAL_GUESTBOOK } from './utils/sampleData';
import { retroAudio } from './utils/audio';

const BACKEND_URL = 'http://localhost:4000';

export default function App() {
  const [activeTab, setActiveTab] = useState<'gallery' | 'widgets' | 'embed' | 'uploader'>('gallery');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [isEmbedModalOpen, setIsEmbedModalOpen] = useState<boolean>(false);

  // Core Data Stores
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [guestbookEntries, setGuestbookEntries] = useState<GuestbookEntry[]>(INITIAL_GUESTBOOK);
  const [visitorCount, setVisitorCount] = useState<number>(42981);

  // Sync dark mode class on document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Fetch live posts from Port 4000 PostgreSQL API on load
  useEffect(() => {
    async function fetchLivePosts() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/posts`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.ok && Array.isArray(data.posts) && data.posts.length > 0) {
          const mappedPosts: Post[] = data.posts.map((p: any) => ({
            id: p.id,
            author: p.author || 'root',
            handle: `:> ${p.author || 'root'}`,
            avatar: '👾',
            timestamp: new Date(p.createdAt).toLocaleDateString() + ' ' + new Date(p.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            imageSrc: p.imagePath?.startsWith('/') ? `${BACKEND_URL}${p.imagePath}` : p.imagePath,
            filter: p.filterApplied || 'none',
            caption: p.caption || '',
            mood: p.mood || '[:> VIBING IN CYBERSPACE]',
            webring: p.webring || 'unix.hackers.retro',
            location: p.location || 'Neogram Node // 1996',
            likes: p.likes || 0,
            radicals: Math.floor((p.likes || 0) * 0.7),
            bookmarks: Math.floor((p.likes || 0) * 0.3),
            comments: (p.comments || []).map((c: any) => ({
              id: c.id,
              author: c.author || 'guest_surfer',
              avatar: c.avatar || '💬',
              timestamp: new Date(c.timestamp).toLocaleDateString() + ' ' + new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: c.text,
            })),
          }));

          setPosts(mappedPosts);
        }
      } catch (err) {
        console.warn('[:> NEOGRAM GALLERY] Backend node offline or unreachable, using sample data:', err);
      }
    }

    fetchLivePosts();
  }, []);

  // Handlers for Posts & Reactions
  const handleLikePost = async (postId: string) => {
    // Optimistic UI update
    setPosts((prevPosts) =>
      prevPosts.map((post) => {
        if (post.id === postId) {
          const alreadyLiked = post.userLiked;
          return {
            ...post,
            likes: alreadyLiked ? post.likes - 1 : post.likes + 1,
            userLiked: !alreadyLiked,
          };
        }
        return post;
      })
    );

    // Sync with backend API
    try {
      await fetch(`${BACKEND_URL}/api/posts/${postId}/like`, { method: 'POST' });
    } catch {
      // Ignore network drop
    }
  };

  const handleRadicalPost = (postId: string) => {
    setPosts((prevPosts) =>
      prevPosts.map((post) => {
        if (post.id === postId) {
          const alreadyRadical = post.userRadical;
          return {
            ...post,
            radicals: alreadyRadical ? post.radicals - 1 : post.radicals + 1,
            userRadical: !alreadyRadical,
          };
        }
        return post;
      })
    );
  };

  const handleBookmarkPost = (postId: string) => {
    setPosts((prevPosts) =>
      prevPosts.map((post) => {
        if (post.id === postId) {
          return {
            ...post,
            bookmarks: post.bookmarks + 1,
          };
        }
        return post;
      })
    );
  };

  const handleAddComment = async (postId: string, author: string, text: string) => {
    const timestampStr = new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const localComment = {
      id: `c-${Date.now()}`,
      author: author || 'guest_surfer',
      avatar: '💬',
      timestamp: timestampStr,
      text,
    };

    // Optimistic UI update
    setPosts((prevPosts) =>
      prevPosts.map((post) => {
        if (post.id === postId) {
          return {
            ...post,
            comments: [...post.comments, localComment],
          };
        }
        return post;
      })
    );

    // Commit to PostgreSQL centralized ledger on Port 4000
    try {
      const res = await fetch(`${BACKEND_URL}/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorName: author, text }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.comment) {
          setPosts((prevPosts) =>
            prevPosts.map((post) => {
              if (post.id === postId) {
                return {
                  ...post,
                  comments: post.comments.map((c) => (c.id === localComment.id ? { ...c, id: data.comment.id } : c)),
                };
              }
              return post;
            })
          );
        }
      }
    } catch (err) {
      console.warn('[:> NEOGRAM COMMENTS] Failed to sync comment with backend:', err);
    }
  };

  // Handlers for Guestbook
  const handleAddGuestbookEntry = (entry: GuestbookEntry) => {
    setGuestbookEntries([entry, ...guestbookEntries]);
    setVisitorCount((prev) => prev + 1);
  };

  const handleDeleteGuestbookEntry = (id: string) => {
    setGuestbookEntries(guestbookEntries.filter((item) => item.id !== id));
  };

  const handleIncrementCount = (amount: number = 1) => {
    setVisitorCount((prev) => prev + amount);
  };

  const handleResetCount = () => {
    setVisitorCount(1);
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'dark bg-[#0a0e14] text-[#e6edf3]' : 'bg-[#285577] text-black'} flex flex-col font-mono selection:bg-[#000080] selection:text-white transition-colors duration-150`}>
      {/* Vintage Terminal Marquee Banner with System Prompt :> */}
      <div className="bg-[#000000] text-[#39ff14] border-b-2 border-black py-1 px-4 text-xs overflow-hidden select-none font-mono">
        <div className="animate-marquee">
          :&gt; NEOGRAM RETRO STATIC GALLERY // CONNECTED TO POSTGRESQL PUBLISHING NODE (PORT 4000) // 28.8K V.34 DIAL-UP OK // SYSTEM PROMPT READY_
        </div>
      </div>

      {/* 3-Zone Top Navigation Bar */}
      <TopNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        openEmbedModal={() => setIsEmbedModalOpen(true)}
      />

      {/* Main View Area */}
      <main className="flex-1 pb-16">
        {activeTab === 'gallery' && (
          <PhotoGallery
            posts={posts}
            onAddComment={handleAddComment}
            onLikePost={handleLikePost}
            onRadicalPost={handleRadicalPost}
            onBookmarkPost={handleBookmarkPost}
            openEmbedModal={() => setIsEmbedModalOpen(true)}
          />
        )}

        {activeTab === 'widgets' && (
          <RetroWidgets
            guestbookEntries={guestbookEntries}
            onAddGuestbookEntry={handleAddGuestbookEntry}
            onDeleteGuestbookEntry={handleDeleteGuestbookEntry}
            visitorCount={visitorCount}
            onIncrementCount={handleIncrementCount}
            onResetCount={handleResetCount}
          />
        )}

        {activeTab === 'embed' && (
          <div className="max-w-4xl mx-auto py-8 px-4">
            <div className="bg-[#dcd8d0] dark:bg-[#161b22] border-4 border-black dark:border-[#384252] pixel-box p-5 space-y-4 text-black dark:text-[#e6edf3]">
              <div className="bg-[#2a2c30] text-white px-3 py-1.5 text-xs font-mono font-bold flex items-center justify-between border-b-2 border-black">
                <span>:&gt; embed_architecture_specs.txt</span>
                <span className="text-[#39ff14]">DOCS</span>
              </div>
              <p className="text-xs font-mono text-gray-800 dark:text-gray-300">
                Neogram uses standardized BEM class hooks and CSS variables so you can drop your personal stream onto any static host (Neocities, GitHub Pages, or self-hosted web server) and skin it with custom CSS.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                <div className="bg-white dark:bg-[#0d1117] p-3.5 border-3 border-black dark:border-[#384252]">
                  <div className="font-bold text-[#000080] dark:text-[#58a6ff] mb-2">Core BEM Hooks:</div>
                  <ul className="space-y-1 text-[11px]">
                    <li><span className="font-bold">.neogram-feed</span> - Feed flex wrapper</li>
                    <li><span className="font-bold">.neogram-post</span> - Chunky post card container</li>
                    <li><span className="font-bold">.neogram-post__header</span> - User metadata row</li>
                    <li><span className="font-bold">.neogram-post__media</span> - Blocky sprite &amp; shader viewport</li>
                    <li><span className="font-bold">.neogram-post__caption</span> - Text log block</li>
                    <li><span className="font-bold">.neogram-post__tags</span> - Mood &amp; webring tags</li>
                    <li><span className="font-bold">.neogram-post__actions</span> - Reaction button bar</li>
                    <li><span className="font-bold">.neogram-comment</span> - Comment ledger entry</li>
                    <li><span className="font-bold">.neogram-button</span> - Chunky pixel push button</li>
                  </ul>
                </div>
                <div className="bg-white dark:bg-[#0d1117] p-3.5 border-3 border-black dark:border-[#384252]">
                  <div className="font-bold text-[#000080] dark:text-[#58a6ff] mb-2">Interactive Widgets:</div>
                  <ul className="space-y-1 text-[11px]">
                    <li><span className="font-bold">.neogram-guestbook</span> - Public visitor ledger</li>
                    <li><span className="font-bold">.neogram-counter</span> - Digital LED odometer counter</li>
                    <li><span className="font-bold">.neogram-badge</span> - 88x31 micro button</li>
                  </ul>
                  <div className="mt-4 pt-3 border-t-2 border-gray-300 dark:border-gray-700">
                    <button
                      onClick={() => {
                        retroAudio.playClick();
                        setIsEmbedModalOpen(true);
                      }}
                      className="pixel-btn bg-[#ffff99] text-black w-full text-xs font-bold py-2"
                    >
                      Open Embed Code Generator &amp; Snippets
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Embed Modal Overlay */}
      {isEmbedModalOpen && <EmbedModal isOpen={isEmbedModalOpen} onClose={() => setIsEmbedModalOpen(false)} />}
    </div>
  );
}
