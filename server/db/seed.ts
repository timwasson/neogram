import { query } from './index';

export const PLACEHOLDER_IMAGES = [
  {
    imagePath: 'https://picsum.photos/id/250/800/800',
    thumbnailPath: 'https://picsum.photos/id/250/400/400',
    filter: 'sepia',
    caption: ':> Testing the manual lens on my vintage 1996 mechanical camera. Analog tactile dials and film grain are unbeatable.',
    mood: '[:> CODING IN THE DARK]',
    webring: 'unix.hackers.retro',
    location: 'Tokyo // Darkroom Lab #3',
    likes: 42,
    comments: [
      { author: 'sysadmin_claire', text: ':> Beautiful retro optics! The warmth on that brass shutter ring is gorgeous.' },
      { author: 'pixel_monk', text: ':> Analog mechanical gear is timeless.' }
    ]
  },
  {
    imagePath: 'https://picsum.photos/id/1/800/800',
    thumbnailPath: 'https://picsum.photos/id/1/400/400',
    filter: 'crt',
    caption: ':> Midnight compile session. Late night coffee, terminal buffers, and dial-up tones humming through the modem.',
    mood: '[:> COMPILING KERNEL]',
    webring: 'unix.hackers.retro',
    location: 'Sparcstation // Node #4',
    likes: 88,
    comments: [
      { author: 'cyber_deck', text: ':> Late night hacking sessions hit different.' },
      { author: 'retro_gazer', text: ':> Love the phosphor glow!' }
    ]
  },
  {
    imagePath: 'https://picsum.photos/id/338/800/800',
    thumbnailPath: 'https://picsum.photos/id/338/400/400',
    filter: 'cyberpunk',
    caption: ':> Electric Town after dark. Neon reflections on wet asphalt while listening to city pop tapes.',
    mood: '[:> VIBING TO CITY POP]',
    webring: 'neocities.cyberpunk',
    location: 'Electric Town // Chome 4',
    likes: 67,
    comments: [
      { author: 'lofi_surfer', text: ':> City pop vibe is 10/10.' }
    ]
  },
  {
    imagePath: 'https://placebear.com/800/800',
    thumbnailPath: 'https://placebear.com/400/400',
    filter: 'vga',
    caption: ':> Node mascot spotted guarding the server rack. High-five for 99.9% uptime on the static webring!',
    mood: '[:> SURFING WEBRINGS]',
    webring: 'x11.underground.90s',
    location: 'Pacific Northwest // Node HQ',
    likes: 95,
    comments: [
      { author: 'arcade_queen', text: ':> The best server admin in cyberspace.' }
    ]
  }
];

import { getAllPosts, savePost } from '../services/postStorage';

export async function seedInitialPostsIfEmpty() {
  try {
    // 1. Check if posts already exist on disk
    const existingPosts = await getAllPosts();
    const count = existingPosts.length;

    if (count > 0) {
      console.log(`[:> DB SEED] Found ${count} posts in static storage. Seed check complete.`);
      return;
    }

    // 2. Only if static storage is completely empty, find an existing user or create a seed root user
    let userResult = await query("SELECT id, handle, email FROM users ORDER BY created_at ASC LIMIT 1");
    let userId: string;
    let handle = 'cyber_phantom';
    let email = 'root@neogram.retro';

    if (userResult.rows.length === 0) {
      const newUser = await query(
        `
        INSERT INTO users (email, handle, site_url, deployment_type)
        VALUES ('root@neogram.retro', 'cyber_phantom', 'http://cyber_phantom.neocities.org', 'neocities')
        RETURNING id, handle, email
      `
      );
      userId = newUser.rows[0].id;
      handle = newUser.rows[0].handle || handle;
      email = newUser.rows[0].email || email;
    } else {
      userId = userResult.rows[0].id;
      handle = userResult.rows[0].handle || handle;
      email = userResult.rows[0].email || email;
    }

    console.log('[:> DB SEED] Seeding initial retro posts into static storage JSON...');

    for (let i = 0; i < PLACEHOLDER_IMAGES.length; i++) {
      const p = PLACEHOLDER_IMAGES[i];
      try {
        const postId = crypto.randomUUID();
        await savePost({
          id: postId,
          userId,
          imagePath: p.imagePath,
          thumbnailPath: p.thumbnailPath,
          photos: [{ imagePath: p.imagePath, thumbnailPath: p.thumbnailPath }],
          caption: p.caption,
          filterApplied: p.filter,
          mood: p.mood,
          webring: p.webring,
          location: p.location,
          likes: p.likes,
          createdAt: new Date(Date.now() - (PLACEHOLDER_IMAGES.length - i) * 3600000).toISOString(),
          handle,
          email,
          author: handle,
          comments: p.comments.map((c) => ({
            id: crypto.randomUUID(),
            postId,
            author: c.author,
            text: c.text,
            timestamp: new Date().toISOString(),
          })),
        });
      } catch (err) {
        console.error('[:> DB SEED ERROR] Failed to seed post:', err);
      }
    }

    console.log('[:> DB SEED] Successfully seeded initial placeholder posts to static JSON.');
  } catch (err) {
    console.error('[:> DB SEED ERROR]', err);
  }
}
