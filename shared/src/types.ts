// Player and Game Types
export interface Player {
  id: string;
  username: string;
  walletAddress?: string;
}

export interface GameSession {
  id: string;
  playerId: string;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'abandoned';
  paymentVerified: boolean;
}

// Score Submission Types
export interface ScoreSubmission {
  sessionId: string;
  wallet: string;
  score: number;
  gameData: GameData;
  timestamp: Date;
}

export interface GameData {
  duration: number; // in seconds
  foodEaten: number;
  maxLength: number;
  moves: number;
  collisionType?: 'wall' | 'self';
}

// Player Statistics Types
export interface PlayerStats {
  wallet: string;
  totalScore: number;
  highScore: number;
  gamesPlayed: number;
  lastPlayed: number; // timestamp
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
}

// Payment and x402 Integration Types
export interface PaymentRequest {
  playerId: string;
  amount: number;
  currency: 'USD' | 'BTC' | 'SAT';
}

export interface PaymentVerification {
  transactionId: string;
  verified: boolean;
  amount: number;
  timestamp: Date;
}

// Leaderboard Types
// Leaderboard Types
export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  username?: string;
  score: number;
  gamesPlayed: number;
  lastPlayed: number;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  totalPlayers: number;
  lastUpdated: Date;
  type: 'total' | 'high';
}