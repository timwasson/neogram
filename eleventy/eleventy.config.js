export default function (eleventyConfig) {
  // Passthrough static assets so the generated static site is completely self-contained
  eleventyConfig.addPassthroughCopy({ 'public/css': 'css' });
  eleventyConfig.addPassthroughCopy({ 'public/uploads': 'uploads' });
  eleventyConfig.addPassthroughCopy({ 'public/js': 'js' });
  eleventyConfig.addPassthroughCopy({ 'embed/embed.js': 'embed.js' });
  eleventyConfig.addPassthroughCopy({ 'embed/neogram-embed.css': 'neogram-embed.css' });

  // Custom filters for retro display
  eleventyConfig.addFilter('formatDate', (dateStr) => {
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

  eleventyConfig.addFilter('uppercase', (str) => {
    return str ? String(str).toUpperCase() : '';
  });

  return {
    dir: {
      input: 'eleventy/src',
      output: 'dist/static-gallery',
      includes: '_includes',
      data: '_data',
    },
    templateFormats: ['njk', 'html', 'md'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
}
