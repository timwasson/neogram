import { Router, Request, Response } from 'express';
import { config } from '../config';

export const docsRouter = Router();

/**
 * GET /docs
 * Serves the comprehensive retro documentation portal and embed guides
 */
docsRouter.get('/docs', (req: Request, res: Response) => {
  const currentUser = res.locals.currentUser;
  const rawAppUrl = res.locals.appUrl || config.appUrl || `${req.protocol}://${req.get('host')}`;
  const baseUrl = (rawAppUrl && !rawAppUrl.includes('localhost') && !rawAppUrl.includes('127.0.0.1'))
    ? rawAppUrl
    : 'https://neogram.club';

  const stationHandle = currentUser ? currentUser.handle : 'your_handle';
  const stationUin = currentUser && currentUser.uin ? currentUser.uin : 100101;
  const userSites = res.locals.userSites || [];
  const activeSite = res.locals.activeSite || (userSites.length > 0 ? userSites[0] : null);

  const stationSiteUrl = activeSite && activeSite.site_url
    ? activeSite.site_url
    : (currentUser && currentUser.site_url ? currentUser.site_url : `https://${stationHandle}.neocities.org`);

  const deployPath = activeSite && activeSite.deploy_path !== null && activeSite.deploy_path !== undefined
    ? String(activeSite.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : (currentUser && currentUser.deploy_path !== null && currentUser.deploy_path !== undefined
      ? String(currentUser.deploy_path).trim().replace(/^\/+|\/+$/g, '')
      : 'neogram');

  const activeSiteSlug = activeSite ? activeSite.slug : 'main';
  const activeSiteName = activeSite ? activeSite.name : 'Primary Site';

  const requestedTopic = (req.query.topic as string) || 'quickstart';

  res.render('docs', {
    title: 'Neogram - Documentation Center & Embed Manual',
    activeView: 'docs',
    appUrl: baseUrl,
    stationHandle,
    stationUin,
    stationSiteUrl,
    deployPath,
    userSites,
    activeSite,
    activeSiteSlug,
    activeSiteName,
    activeTopic: requestedTopic,
    isAuthenticated: !!currentUser,
  });
});

/**
 * Topic shortcut redirects, e.g. /docs/neocities, /docs/embeds
 */
docsRouter.get('/docs/:topic', (req: Request, res: Response) => {
  const { topic } = req.params;
  res.redirect(`/docs?topic=${encodeURIComponent(topic)}`);
});
