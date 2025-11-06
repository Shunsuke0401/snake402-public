import sqlite3 from 'sqlite3';
import { join } from 'path';

// Define types locally to avoid import issues
interface PlayerStats {
  wallet: string;
  totalScore: number;
  highScore: number;
  gamesPlayed: number;
  lastPlayed: number;
}

interface LeaderboardEntry {
  rank: number;
  wallet: string;
  username?: string;
  score: number;
  gamesPlayed: number;
  lastPlayed: number;
}

interface EntryFeeRecord {
  id?: number;
  amount: number;
  timestamp: number;
  wallet?: string;
}

interface DailyPlayerStats {
  wallet: string;
  totalScoreDaily: number;
  highScoreDaily: number;
  gamesPlayedDaily: number;
  lastPlayedDaily: number;
}

// Enable verbose mode for debugging
const sqlite = sqlite3.verbose();

class Database {
  private db: sqlite3.Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(process.cwd(), 'snake402.db');
    this.db = new sqlite.Database(path, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
      } else {
        console.log('✅ Connected to SQLite database:', path);
        this.initializeTables();
      }
    });
  }

  private initializeTables(): void {
    const createPlayerStatsTable = `
      CREATE TABLE IF NOT EXISTS player_stats (
        wallet TEXT PRIMARY KEY,
        total_score INTEGER DEFAULT 0,
        high_score INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        last_played INTEGER DEFAULT 0
      )
    `;

    this.db.run(createPlayerStatsTable, (err) => {
      if (err) {
        console.error('❌ Error creating player_stats table:', err.message);
      } else {
        console.log('✅ Player stats table ready');
      }
    });

    const createEntryFeesTable = `
      CREATE TABLE IF NOT EXISTS entry_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        wallet TEXT
      )
    `;

    this.db.run(createEntryFeesTable, (err) => {
      if (err) {
        console.error('❌ Error creating entry_fees table:', err.message);
      } else {
        console.log('✅ Entry fees table ready');
      }
    });

    const createDailyStatsTable = `
      CREATE TABLE IF NOT EXISTS daily_player_stats (
        wallet TEXT PRIMARY KEY,
        total_score_daily INTEGER DEFAULT 0,
        high_score_daily INTEGER DEFAULT 0,
        games_played_daily INTEGER DEFAULT 0,
        last_played_daily INTEGER DEFAULT 0
      )
    `;

    this.db.run(createDailyStatsTable, (err) => {
      if (err) {
        console.error('❌ Error creating daily_player_stats table:', err.message);
      } else {
        console.log('✅ Daily player stats table ready');
      }
    });
  }

  async getPlayerStats(wallet: string): Promise<PlayerStats | null> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM player_stats WHERE wallet = ?';
      this.db.get(query, [wallet], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve({
            wallet: row.wallet,
            totalScore: row.total_score,
            highScore: row.high_score,
            gamesPlayed: row.games_played,
            lastPlayed: row.last_played
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async updatePlayerStats(wallet: string, score: number): Promise<PlayerStats> {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      
      // First, get current stats or create new player
      this.getPlayerStats(wallet).then(currentStats => {
        const newTotalScore = (currentStats?.totalScore || 0) + score;
        const newHighScore = Math.max(currentStats?.highScore || 0, score);
        const newGamesPlayed = (currentStats?.gamesPlayed || 0) + 1;

        const query = `
          INSERT OR REPLACE INTO player_stats 
          (wallet, total_score, high_score, games_played, last_played)
          VALUES (?, ?, ?, ?, ?)
        `;

        this.db.run(query, [wallet, newTotalScore, newHighScore, newGamesPlayed, timestamp], function(err) {
          if (err) {
            reject(err);
          } else {
            resolve({
              wallet,
              totalScore: newTotalScore,
              highScore: newHighScore,
              gamesPlayed: newGamesPlayed,
              lastPlayed: timestamp
            });
          }
        });
      }).catch(reject);
    });
  }

  async getLeaderboard(type: 'total' | 'high', limit: number = 10): Promise<LeaderboardEntry[]> {
    return new Promise((resolve, reject) => {
      const scoreColumn = type === 'total' ? 'total_score' : 'high_score';
      const query = `
        SELECT wallet, ${scoreColumn} as score, games_played, last_played
        FROM player_stats 
        WHERE ${scoreColumn} > 0
        ORDER BY ${scoreColumn} DESC 
        LIMIT ?
      `;

      this.db.all(query, [limit], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const entries: LeaderboardEntry[] = rows.map((row, index) => ({
            rank: index + 1,
            wallet: row.wallet,
            score: row.score,
            gamesPlayed: row.games_played,
            lastPlayed: row.last_played
          }));
          resolve(entries);
        }
      });
    });
  }

  async getTotalPlayers(): Promise<number> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT COUNT(*) as count FROM player_stats WHERE games_played > 0';
      this.db.get(query, [], (err, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  // Entry fees helpers
  async recordEntryFee(amount: number, wallet?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      const query = 'INSERT INTO entry_fees (amount, timestamp, wallet) VALUES (?, ?, ?)';
      this.db.run(query, [amount, timestamp, wallet || null], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  async getTotalEntryFeesSince(cutoff: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT COALESCE(SUM(amount), 0) as total FROM entry_fees WHERE timestamp >= ?';
      this.db.get(query, [cutoff], (err, row: any) => {
        if (err) reject(err); else resolve(row.total || 0);
      });
    });
  }

  // Daily stats helpers
  async getDailyPlayerStats(wallet: string): Promise<DailyPlayerStats | null> {
    return new Promise((resolve, reject) => {
      const query = 'SELECT * FROM daily_player_stats WHERE wallet = ?';
      this.db.get(query, [wallet], (err, row: any) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve({
            wallet: row.wallet,
            totalScoreDaily: row.total_score_daily,
            highScoreDaily: row.high_score_daily,
            gamesPlayedDaily: row.games_played_daily,
            lastPlayedDaily: row.last_played_daily,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async updateDailyPlayerStats(wallet: string, score: number): Promise<DailyPlayerStats> {
    return new Promise((resolve, reject) => {
      const timestamp = Date.now();
      this.getDailyPlayerStats(wallet).then(current => {
        const newTotal = (current?.totalScoreDaily || 0) + score;
        const newHigh = Math.max(current?.highScoreDaily || 0, score);
        const newGames = (current?.gamesPlayedDaily || 0) + 1;
        const query = `
          INSERT OR REPLACE INTO daily_player_stats 
          (wallet, total_score_daily, high_score_daily, games_played_daily, last_played_daily)
          VALUES (?, ?, ?, ?, ?)
        `;
        this.db.run(query, [wallet, newTotal, newHigh, newGames, timestamp], (err) => {
          if (err) reject(err); else resolve({
            wallet,
            totalScoreDaily: newTotal,
            highScoreDaily: newHigh,
            gamesPlayedDaily: newGames,
            lastPlayedDaily: timestamp,
          });
        });
      }).catch(reject);
    });
  }

  async getDailyLeaderboard(type: 'total' | 'high', limit: number = 10): Promise<LeaderboardEntry[]> {
    return new Promise((resolve, reject) => {
      const scoreColumn = type === 'total' ? 'total_score_daily' : 'high_score_daily';
      const query = `
        SELECT wallet, ${scoreColumn} as score, games_played_daily as games_played, last_played_daily as last_played
        FROM daily_player_stats 
        WHERE ${scoreColumn} > 0
        ORDER BY ${scoreColumn} DESC 
        LIMIT ?
      `;
      this.db.all(query, [limit], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const entries: LeaderboardEntry[] = rows.map((row, index) => ({
            rank: index + 1,
            wallet: row.wallet,
            score: row.score,
            gamesPlayed: row.games_played,
            lastPlayed: row.last_played
          }));
          resolve(entries);
        }
      });
    });
  }

  async getDailyScoresSum(type: 'total' | 'high'): Promise<number> {
    return new Promise((resolve, reject) => {
      const scoreColumn = type === 'total' ? 'total_score_daily' : 'high_score_daily';
      const query = `SELECT COALESCE(SUM(${scoreColumn}), 0) as total FROM daily_player_stats WHERE ${scoreColumn} > 0`;
      this.db.get(query, [], (err, row: any) => {
        if (err) reject(err); else resolve(row.total || 0);
      });
    });
  }

  async resetDailyStats(): Promise<void> {
    return new Promise((resolve, reject) => {
      const query = `UPDATE daily_player_stats SET total_score_daily = 0, high_score_daily = 0, games_played_daily = 0`;
      this.db.run(query, [], (err) => { if (err) reject(err); else resolve(); });
    });
  }

  // Remove a single player from both lifetime and daily stats
  async removePlayer(wallet: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('DELETE FROM player_stats WHERE wallet = ?', [wallet], (err) => {
          if (err) {
            reject(err);
            return;
          }
          this.db.run('DELETE FROM daily_player_stats WHERE wallet = ?', [wallet], (err2) => {
            if (err2) reject(err2); else resolve();
          });
        });
      });
    });
  }

  // Remove multiple players
  async removePlayers(wallets: string[]): Promise<string[]> {
    const removed: string[] = [];
    for (const w of wallets) {
      await this.removePlayer(w).catch(() => {});
      removed.push(w);
    }
    return removed;
  }

  // Remove top N players by total score
  async removeTopPlayers(limit: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const query = `SELECT wallet FROM player_stats WHERE total_score > 0 ORDER BY total_score DESC LIMIT ?`;
      this.db.all(query, [limit], async (err, rows: any[]) => {
        if (err) return reject(err);
        const wallets: string[] = rows.map(r => r.wallet);
        const removed = await this.removePlayers(wallets);
        resolve(removed);
      });
    });
  }

  close(): void {
    this.db.close((err) => {
      if (err) {
        console.error('❌ Error closing database:', err.message);
      } else {
        console.log('✅ Database connection closed');
      }
    });
  }
}

export default Database;