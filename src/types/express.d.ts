/**
 * Express Type Augmentations
 * Extends Express types to include custom properties
 */

import { UserProfile } from './database.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserProfile;
    }
  }
}

export {};
