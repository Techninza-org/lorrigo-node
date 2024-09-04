import { Request, Response, NextFunction } from 'express';
import apicache from 'apicache';

const cache = apicache.middleware;

export function cacheControl(cacheDuration: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', `public, max-age=${convertToSeconds(cacheDuration)}`);
    next();
  };
}

export function invalidateCache(cacheKeys: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    cacheKeys.forEach(key => {
      apicache.clear(key);
    });
    next();
  };
}

/**
 * Convert cache duration to seconds
 * @param duration - Cache duration string (e.g., '5 minutes')
 * @returns Duration in seconds
 */
function convertToSeconds(duration: string): number {
  const [value, unit] = duration.split(' ');
  const unitsInSeconds: Record<string, number> = {
    'second': 1,
    'seconds': 1,
    'minute': 60,
    'minutes': 60,
    'hour': 3600,
    'hours': 3600,
    'day': 86400,
    'days': 86400
  };
  return parseInt(value, 10) * (unitsInSeconds[unit] || 0);
}
