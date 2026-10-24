export default function (eleventyConfig) {
  // Disable template caching so multi-tenant builds with different pathPrefix / options
  // never contaminate each other in the long-running server process
  eleventyConfig.setUseTemplateCache(false);

  // Passthrough static assets so the generated static site is completely self-contained
  eleventyConfig.addPassthroughCopy({ 'public/css': 'css' });
  eleventyConfig.addPassthroughCopy({ 'public/icons': 'icons' });
  eleventyConfig.addPassthroughCopy({ 'public/js': 'js' });
  eleventyConfig.addPassthroughCopy({ 'embed': 'embed' });
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

  eleventyConfig.addFilter('formatDateTime', (dateStr) => {
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

  eleventyConfig.addFilter('uppercase', (str) => {
    return str ? String(str).toUpperCase() : '';
  });

  const dirConfig = {
    input: 'eleventy/src',
    includes: '_includes',
    data: '_data',
  };

  // Only assign output in config if explicitly provided via env;
  // otherwise let programmatic new Eleventy(input, targetOutputDir) govern output
  if (process.env.ELEVENTY_OUTPUT_DIR) {
    dirConfig.output = process.env.ELEVENTY_OUTPUT_DIR;
  }

  const configObj = {
    templateFormats: ['njk', 'html', 'md'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
    dir: dirConfig,
  };

  if (process.env.ELEVENTY_PATH_PREFIX) {
    configObj.pathPrefix = process.env.ELEVENTY_PATH_PREFIX;
  }

  return configObj;
}
