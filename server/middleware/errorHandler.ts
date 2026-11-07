import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status || 500;
  // Never leak internals (SQL, paths, stack text) to clients on server faults in production
  const message =
    status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Internal System Kernel Fault'
      : err.message || 'Internal System Kernel Fault';

  console.error(`[:> SYSTEM ERROR] ${req.method} ${req.url}:`, err.stack || err);

  if (req.accepts('html') && !req.path.startsWith('/api')) {
    const safeMessage = String(message)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    res.status(status).send(`
      <!doctype html>
      <html>
        <head>
          <title>Neogram - Error ${status}</title>
          <style>
            body { background: #000080; color: #ffffff; font-family: monospace; padding: 2rem; }
            h1 { background: #aaaaaa; color: #000080; display: inline-block; padding: 4px 8px; }
            pre { background: #000000; color: #ff5555; padding: 1rem; border: 2px solid #ffffff; }
            a { color: #ffff00; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>*** STOP: 0x000000ED NEOGRAM SYSTEM FAULT ***</h1>
          <p>An unhandled exception occurred in the server pipeline:</p>
          <pre>${safeMessage}</pre>
          <p><a href="/">&lt; Return to Safe Terminal</a></p>
        </body>
      </html>
    `);
    return;
  }

  res.status(status).json({
    ok: false,
    error: {
      status,
      message,
    },
  });
}
