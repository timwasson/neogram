import { query } from './index';
import { processBase64Image } from '../services/imageProcessor';
import { RETRO_SVGS } from '../../src/utils/sampleData';

export async function seedInitialPostsIfEmpty() {
  try {
    const existing = await query('SELECT COUNT(*) as count FROM posts');
    const count = parseInt(existing.rows[0].count, 10);
    if (count > 0) {
      console.log(`[:> DB SEED] Database already has ${count} posts. Skipping seed.`);
      return;
    }

    console.log('[:> DB SEED] Seeding initial retro posts into PostgreSQL...');

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

    // 2. Seed posts
    const initialPosts = [
      {
        imageSrc: RETRO_SVGS.pixelWorkstation,
        filter: 'crt',
        caption: ':> Booted custom BSD workstation. Check the pixel desk setup: large steaming coffee mug, compact keyboard, oversized mousepad, and potted cactus up on the top shelf. Blinking monitor & keyboard LEDs are soothing during late night dial-up compiles.',
        mood: '[:> CODING IN THE DARK]',
        webring: 'unix.hackers.retro',
        location: 'Sparcstation // Node #4',
        likes: 42,
        comments: [
          { author: 'sysadmin_claire', text: ':> Radical sprite work! The tonal shading on the beige casing and the steam from the coffee mug give it so much cozy depth.' },
          { author: 'pixel_monk', text: ':> Love the clean borderless LEDs and the compact keyboard balance!' }
        ]
      },
      {
        imageSrc: RETRO_SVGS.pixelSkyline,
        filter: 'cyberpunk',
        caption: ':> Neon dusk over Akihabara. Snapped with my low-res digital camera. Check the blinking radio tower beacon on the skyline.',
        mood: '[:> VIBING TO CITY POP]',
        webring: 'neocities.cyberpunk',
        location: 'Electric Town Chome 4',
        likes: 88,
        comments: [
          { author: 'cyber_deck', text: ':> City pop vibe is 10/10. What camera was this?' },
          { author: 'retro_gazer', text: ':> The pink and cyan dithering is pure 1996 aesthetic.' }
        ]
      },
      {
        imageSrc: RETRO_SVGS.pixelCassette,
        filter: 'sepia',
        caption: ':> Found my old 1996 mixtapes in a shoebox. Recorded off FM radio late at night. Rewound using a hexagon pencil.',
        mood: '[:> DOWNLOADING MIDI]',
        webring: 'audio.lofi.cassette',
        location: 'Basement Studio // Tape Deck #2',
        likes: 67,
        comments: [
          { author: 'lofi_surfer', text: ':> The pencil rewind trick! That brings back memories.' }
        ]
      },
      {
        imageSrc: RETRO_SVGS.pixelArcade,
        filter: 'vga',
        caption: ':> Corner arcade down on 5th Street. The CRT scanlines on this cabinet are legendary. Dropped 4 quarters on 1UP high score.',
        mood: '[:> SURFING WEBRINGS]',
        webring: 'x11.underground.90s',
        location: 'Tokyo Funland Arcade // Cabinet 04',
        likes: 95,
        comments: [
          { author: 'arcade_queen', text: ':> INSERT COIN never looked so clean.' }
        ]
      }
    ];

    for (const p of initialPosts) {
      try {
        const processed = await processBase64Image(p.imageSrc, p.filter);
        const postInsert = await query(
          `
          INSERT INTO posts (user_id, image_path, thumbnail_path, caption, filter_applied, mood, webring, location, likes_count)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `,
          [userId, processed.imagePath, processed.thumbnailPath, p.caption, p.filter, p.mood, p.webring, p.location, p.likes]
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

    console.log('[:> DB SEED] Successfully seeded initial posts and comments.');
  } catch (err) {
    console.error('[:> DB SEED ERROR]', err);
  }
}
