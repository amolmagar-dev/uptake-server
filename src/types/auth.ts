/**
 * Authentication Types
 * Type definitions for authentication-related operations
 */

import { UserProfile } from './database.js';

// JWT Payload
export interface JWTPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

// Login Request/Response
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserProfile;
}

// Register Request/Response
export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface RegisterResponse {
  token: string;
  user: UserProfile;
}

// Profile Update Request
export interface ProfileUpdateRequest {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}
