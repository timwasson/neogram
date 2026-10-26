import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import nunjucks from 'nunjucks';

/**
 * Strips YAML frontmatter from Eleventy template strings.
 */
function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*/, '');
}

/**
 * Creates a URL filter consistent with Eleventy's pathPrefix handling.
 */
function createUrlFilter(pathPrefix: string) {
  const cleanPrefix = ('/' + (pathPrefix || '').replace(/^\/+|\/+$/g, '') + '/').replace(/^\/\/+/, '/');
  return function urlFilter(urlStr: string | undefined): string {
    if (!urlStr) return '';
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://') || urlStr.startsWith('data:')) {
      return urlStr;
    }
    if (urlStr === '/' || urlStr === '') {
      return cleanPrefix;
    }
    const cleanPath = urlStr.replace(/^\/+/, '');
    return cleanPrefix === '/' ? `/${cleanPath}` : `${cleanPrefix}${cleanPath}`;
  };
}

/**
 * Cached template strings loaded from eleventy/src/.
 */
let cachedTemplates: {
  index?: string;
  photo?: string;
  friends?: string;
  baseLayout?: string;
} | null = null;

async function loadTemplates() {
  if (cachedTemplates) return cachedTemplates;

  const srcDir = path.join(process.cwd(), 'eleventy/src');
  const indexRaw = await fs.readFile(path.join(srcDir, 'index.njk'), 'utf-8');
  const photoRaw = await fs.readFile(path.join(srcDir, 'photo.njk'), 'utf-8');
  const friendsRaw = await fs.readFile(path.join(srcDir, 'friends.njk'), 'utf-8');
  const baseLayout = await fs.readFile(path.join(srcDir, '_includes/layouts/base.njk'), 'utf-8');

  cachedTemplates = {
    index: stripFrontmatter(indexRaw),
    photo: stripFrontmatter(photoRaw),
    friends: stripFrontmatter(friendsRaw),
    baseLayout,
  };

  return cachedTemplates;
}

/**
 * Configures an in-memory Nunjucks environment matching Eleventy's filter set.
 */
function createNunjucksEnv(pathPrefix: string): nunjucks.Environment {
  const env = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([
      path.join(process.cwd(), 'eleventy/src'),
      path.join(process.cwd(), 'eleventy/src/_includes'),
    ]),
    { autoescape: true }
  );

  env.addFilter('url', createUrlFilter(pathPrefix));

  env.addFilter('formatDate', (dateStr: any) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return String(dateStr);
    }
  });

  env.addFilter('formatDateTime', (dateStr: any) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return (
        d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }) +
        ', ' +
        d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    } catch {
      return String(dateStr);
    }
  });

  env.addFilter('uppercase', (str: any) => {
    return str ? String(str).toUpperCase() : '';
  });

  return env;
}

/**
 * Renders a single photo page (photos/<postId>/index.html) in ~1-3ms.
 */
export async function renderPhotoPage(siteData: any, post: any): Promise<string> {
  const templates = await loadTemplates();
  const pathPrefix = siteData.pathPrefix || '/';
  const env = createNunjucksEnv(pathPrefix);

  const context = {
    post,
    site: siteData,
  };

  const bodyHtml = env.renderString(templates.photo!, context);
  const title = `Photo by @${post.author || 'user'}`;

  return env.render('layouts/base.njk', {
    ...context,
    content: bodyHtml,
    title,
  });
}

/**
 * Renders the main gallery index page (index.html) in ~1-3ms.
 */
export async function renderGalleryIndex(siteData: any, posts: any[]): Promise<string> {
  const templates = await loadTemplates();
  const pathPrefix = siteData.pathPrefix || '/';
  const env = createNunjucksEnv(pathPrefix);

  const context = {
    posts,
    site: siteData,
  };

  const bodyHtml = env.renderString(templates.index!, context);
  const title = siteData.title || 'Static Photo Stream';

  return env.render('layouts/base.njk', {
    ...context,
    content: bodyHtml,
    title,
  });
}

/**
 * Renders the friends static feed page (friends/index.html) in ~1-3ms.
 */
export async function renderFriendsPage(siteData: any, friendsPosts: any[]): Promise<string> {
  const templates = await loadTemplates();
  const pathPrefix = siteData.pathPrefix || '/';
  const env = createNunjucksEnv(pathPrefix);

  const context = {
    friendsPosts,
    site: siteData,
  };

  const bodyHtml = env.renderString(templates.friends!, context);
  const title = `@${(siteData.author || 'USER').toUpperCase()}'S FRIENDS STATIC STREAM`;

  return env.render('layouts/base.njk', {
    ...context,
    content: bodyHtml,
    title,
  });
}

/**
 * Ensures baseline static CSS, JS, icons, and embed assets are present
 * in the static target directory without needing a full Eleventy run.
 */
export async function ensureStaticAssets(targetOutputDir: string): Promise<void> {
  const markerPath = path.join(targetOutputDir, 'css/neogram.css');
  if (existsSync(markerPath)) {
    return;
  }

  const copyDir = async (src: string, dest: string) => {
    if (!existsSync(src)) return;
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath).catch(() => {});
      }
    }
  };

  await copyDir(path.join(process.cwd(), 'public/css'), path.join(targetOutputDir, 'css'));
  await copyDir(path.join(process.cwd(), 'public/icons'), path.join(targetOutputDir, 'icons'));
  await copyDir(path.join(process.cwd(), 'public/js'), path.join(targetOutputDir, 'js'));
  await copyDir(path.join(process.cwd(), 'embed'), path.join(targetOutputDir, 'embed'));

  // Root embed shortcuts
  const rootFiles = ['embed/embed.js', 'embed/pager.js', 'embed/neogram-embed.css'];
  for (const f of rootFiles) {
    const srcFile = path.join(process.cwd(), f);
    const destFile = path.join(targetOutputDir, path.basename(f));
    if (existsSync(srcFile)) {
      await fs.copyFile(srcFile, destFile).catch(() => {});
    }
  }
}
