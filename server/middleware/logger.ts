import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const statusTag = statusCode >= 400 ? `[ERR ${statusCode}]` : `[OK ${statusCode}]`;
    console.log(`[:> HTTP] ${req.method} ${req.originalUrl} ${statusTag} - ${duration}ms`);
  });
  next();
}
