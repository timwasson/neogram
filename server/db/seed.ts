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

export async function seedInitialPostsIfEmpty() {
  try {
    // 1. Ensure a default root user exists
    let userResult = await query("SELECT * FROM users WHERE email = 'root@neogram.retro'");
    let userId: string;

    if (userResult.rows.length === 0) {
      const newUser = await query(
        `
        INSERT INTO users (email, site_url, deployment_type)
        VALUES ('root@neogram.retro', 'http://cyber_phantom.neocities.org', 'neocities')
        RETURNING id
      `
      );
      userId = newUser.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
    }

    // 2. Check if posts already exist
    const existing = await query('SELECT COUNT(*) as count FROM posts');
    const count = parseInt(existing.rows[0].count, 10);

    // If existing posts were using old local sample SVGs, update them to the fresh placeholder URLs
    const oldSamplePosts = await query(
      "SELECT id FROM posts WHERE image_path LIKE '%1792466641%' OR image_path LIKE '%1792468331669%' OR image_path LIKE '%1792468051032%'"
    );
    if (oldSamplePosts.rows.length > 0) {
      console.log(`[:> DB SEED] Updating ${oldSamplePosts.rows.length} legacy sample posts to interesting placeholder URLs...`);
      for (let i = 0; i < oldSamplePosts.rows.length; i++) {
        const placeholder = PLACEHOLDER_IMAGES[i % PLACEHOLDER_IMAGES.length];
        await query(
          'UPDATE posts SET image_path = $1, thumbnail_path = $2 WHERE id = $3',
          [placeholder.imagePath, placeholder.thumbnailPath, oldSamplePosts.rows[i].id]
        );
      }
    }

    if (count > 0) {
      console.log(`[:> DB SEED] Database has ${count} posts. Seed check complete.`);
      return;
    }

    console.log('[:> DB SEED] Seeding initial retro posts with interesting placeholder URLs into PostgreSQL...');

    for (const p of PLACEHOLDER_IMAGES) {
      try {
        const postInsert = await query(
          `
          INSERT INTO posts (user_id, image_path, thumbnail_path, caption, filter_applied, mood, webring, location, likes_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `,
          [userId, p.imagePath, p.thumbnailPath, p.caption, p.filter, p.mood, p.webring, p.location, p.likes]
        );

        const postId = postInsert.rows[0].id;
        for (const c of p.comments) {
          await query(
            `
            INSERT INTO comments (post_id, author_name, body)
            VALUES ($1, $2, $3)
          `,
            [postId, c.author, c.text]
          );
        }
      } catch (err) {
        console.error('[:> DB SEED ERROR] Failed to seed post:', err);
      }
    }

    console.log('[:> DB SEED] Successfully seeded initial placeholder posts and comments.');
  } catch (err) {
    console.error('[:> DB SEED ERROR]', err);
  }
}
