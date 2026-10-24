import { Router, Request, Response } from 'express';
import { config } from '../config';

export const docsRouter = Router();

/**
 * GET /docs
 * Serves the comprehensive retro documentation portal and embed guides
 */
docsRouter.get('/docs', (req: Request, res: Response) => {
  const currentUser = res.locals.currentUser;
  const baseUrl = config.appUrl || `${req.protocol}://${req.get('host')}`;

  const stationHandle = currentUser ? currentUser.handle : 'your_handle';
  const stationUin = currentUser && currentUser.uin ? currentUser.uin : 100101;
  const stationSiteUrl = currentUser && currentUser.site_url
    ? currentUser.site_url
    : `https://${stationHandle}.neocities.org`;
  const deployPath = currentUser && currentUser.deploy_path !== null && currentUser.deploy_path !== undefined
    ? String(currentUser.deploy_path).trim().replace(/^\/+|\/+$/g, '')
    : 'neogram';

  const requestedTopic = (req.query.topic as string) || 'neocities';

  res.render('docs', {
    title: 'Neogram - Documentation Center & Embed Manual',
    activeView: 'docs',
    appUrl: baseUrl,
    stationHandle,
    stationUin,
    stationSiteUrl,
    deployPath,
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
