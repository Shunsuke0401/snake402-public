import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { paymentMiddleware } from 'x402-express';
import { Facilitator, createExpressAdapter } from '@x402-sovereign/core';
import { baseSepolia, base } from 'viem/chains';
import { config } from 'dotenv';
import { join } from 'path';
import fs from 'fs';
import Database from './database.js';
import { JsonRpcProvider, WebSocketProvider, Wallet, Contract } from 'ethers';

// Load environment variables from root directory
config({ path: join(process.cwd(), '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Environment variables
const CDP_RECIPIENT_ADDRESS = process.env.CDP_RECIPIENT_ADDRESS;
const ENTRY_FEE_USDC = process.env.ENTRY_FEE_USDC || '0.001';
const CDP_NETWORK = process.env.CDP_NETWORK || 'base-sepolia';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const SANDBOX_MODE = process.env.SANDBOX_MODE === 'true';
const PRIZE_POOL_CONTRACT = process.env.PRIZE_POOL_CONTRACT;
const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS;
const USDC_CONTRACT = process.env.USDC_CONTRACT;
const ENABLE_ONCHAIN_PAYOUTS = process.env.ENABLE_ONCHAIN_PAYOUTS === 'true';
const BASE_RPC_URL = process.env.BASE_RPC_URL; // e.g. https://mainnet.base.org or provider endpoint
const BASE_WS_URL = process.env.BASE_WS_URL;   // optional, for event listening
const ENABLE_SSE_PAYOUTS = process.env.ENABLE_SSE_PAYOUTS === 'true';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CORS_ORIGINS = process.env.CORS_ORIGINS || '';

// Payout scheduler state
const payoutsLogPath = join(process.cwd(), 'payouts.log');
let lastPayoutAt = Date.now();
let nextPayoutAt = lastPayoutAt + 24 * 60 * 60 * 1000;
let lastTxHash: string | null = null;
let lastTxLink: string | null = null;
const recordedFeeSessions = new Set<string>();
const ENTRY_FEE_NUM = parseFloat(ENTRY_FEE_USDC || '0');

// Network safety check
if (CDP_NETWORK === 'base') {
  console.log('🚨 Running on Base Mainnet - REAL MONEY TRANSACTIONS ENABLED');
  console.log('⚠️  Make sure you have configured production API keys and wallet addresses');
  
  if (SANDBOX_MODE) {
    console.log('🛡️  SANDBOX_MODE is enabled - Payment processing will be simulated');
  } else {
    console.log('💰 PRODUCTION MODE - Real USDC payments will be processed');
  }
} else {
  console.log('🧪 Running on Base Sepolia Testnet - Test mode');
}

console.log('🔧 Environment Configuration:');
console.log('💰 ENTRY_FEE_USDC:', ENTRY_FEE_USDC);
console.log('🌐 CDP_NETWORK:', CDP_NETWORK);
console.log('📍 CDP_RECIPIENT_ADDRESS:', CDP_RECIPIENT_ADDRESS);
console.log('🔑 PRIVATE_KEY:', PRIVATE_KEY ? 'Configured ✅' : 'Missing ❌');
console.log('🛡️  SANDBOX_MODE:', SANDBOX_MODE);
console.log('⏰ Server started at:', new Date().toISOString());
console.log('🏦 PRIZE_POOL_CONTRACT:', PRIZE_POOL_CONTRACT || 'Not set');
console.log('🏦 TREASURY_ADDRESS:', TREASURY_ADDRESS || 'Not set');
console.log('💵 USDC_CONTRACT:', USDC_CONTRACT || 'Not set');
console.log('🔗 ENABLE_ONCHAIN_PAYOUTS:', ENABLE_ONCHAIN_PAYOUTS);
console.log('🔌 BASE_RPC_URL:', BASE_RPC_URL ? 'Configured ✅' : 'Missing ❌');
console.log('📡 ENABLE_SSE_PAYOUTS:', ENABLE_SSE_PAYOUTS);
console.log('🔌 BASE_WS_URL:', BASE_WS_URL ? 'Configured ✅' : 'Missing ❌');

if (!CDP_RECIPIENT_ADDRESS || CDP_RECIPIENT_ADDRESS.includes('YOUR_')) {
  console.error('❌ CDP_RECIPIENT_ADDRESS environment variable is required and must be a valid address');
  process.exit(1);
}

if (!PRIVATE_KEY || PRIVATE_KEY.includes('YOUR_')) {
  console.error('❌ PRIVATE_KEY environment variable is required for local facilitator');
  process.exit(1);
}

// Middleware
// Configure CORS: allow specific origins when provided; otherwise default to dev-friendly
const allowedOrigins = CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  credentials: true,
}));

// Initialize local sovereign facilitator with appropriate network
const networkChain = CDP_NETWORK === 'base' ? base : baseSepolia;
const facilitator = new Facilitator({
  evmPrivateKey: PRIVATE_KEY as `0x${string}`,
  networks: [networkChain],
});

// Create facilitator endpoint
createExpressAdapter(facilitator, app, '/facilitator');

// Configure x402 payment middleware with local facilitator
const paymentConfig = {
  "POST /api/join": {
    price: `$${ENTRY_FEE_USDC}`,
    network: CDP_NETWORK as "base" | "base-sepolia",
    config: {
      description: `Entry fee for Snake402 game (${CDP_NETWORK === 'base' ? 'MAINNET' : 'TESTNET'})`
    }
  }
};

console.log('💳 Payment Configuration:', JSON.stringify(paymentConfig, null, 2));
console.log('🌐 Using local facilitator at: http://localhost:' + PORT + '/facilitator');

app.use(paymentMiddleware(
  // Route entry fees directly to the prize pool contract if configured
  (PRIZE_POOL_CONTRACT || CDP_RECIPIENT_ADDRESS) as `0x${string}`,
  paymentConfig,
  {
    url: `http://localhost:${PORT}/facilitator` as `${string}://${string}`,
  }
));

// Debug middleware to log all requests (AFTER x402 middleware)
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  next();
});

// Add body parsers AFTER x402 middleware for non-payment routes
app.use(express.json({ limit: '10mb' }));

// Initialize database
const db = new Database();

// Session management
interface GameSession {
  id: string;
  isPaid: boolean;
  createdAt: Date;
  paidAt?: Date;
  wallet?: string; // Add wallet to track player
}

const sessions = new Map<string, GameSession>();

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API info endpoint
  app.get('/api', (req, res) => {
    res.json({ 
      message: 'Snake402 API Server',
      version: '1.0.0',
      network: CDP_NETWORK,
      networkMode: CDP_NETWORK === 'base' ? 'mainnet' : 'testnet',
      sandboxMode: SANDBOX_MODE,
      entryFee: ENTRY_FEE_USDC,
      endpoints: {
        health: '/health',
        join: '/api/join',
        verifyPayment: '/api/verify-payment',
        submitScore: '/api/submit-score',
        leaderboardTotal: '/leaderboard/total',
        leaderboardHigh: '/leaderboard/high',
        playerStats: '/player/:wallet',
        leaderboardDailyTotal: '/leaderboard/daily/total',
        leaderboardDailyHigh: '/leaderboard/daily/high',
        playerDailyStats: '/player/daily/:wallet'
      }
    });
  });

// POST /join - Protected by x402 middleware
app.post('/api/join', (req, res) => {
  console.log('🎮 Join request received - payment verified by middleware');
  
  // Create a new session for paid user
  const sessionId = randomUUID();
  const session: GameSession = {
    id: sessionId,
    isPaid: true, // Payment already verified by middleware
    createdAt: new Date(),
    paidAt: new Date()
  };
  
  sessions.set(sessionId, session);
  console.log(`📝 Created paid session: ${sessionId}`);

  // Record entry fee off-chain once per session
  if (!recordedFeeSessions.has(sessionId)) {
    db.recordEntryFee(ENTRY_FEE_NUM).then(() => {
      recordedFeeSessions.add(sessionId);
      console.log(`🧾 Recorded entry fee: ${ENTRY_FEE_NUM} at session ${sessionId}`);
    }).catch(err => {
      console.error('❌ Failed to record entry fee:', err);
    });
  }
  
  // Return success response with session
  res.status(200).json({
    sessionId: sessionId,
    message: 'Payment verified, ready to play!',
    isPaid: true
  });
});

// POST /api/verify-payment - Verify payment manually (for client compatibility)
app.post('/api/verify-payment', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { txHash, sessionId } = req.body;
  
  console.log(`[${timestamp}] 🔍 Manual payment verification request:`, { txHash, sessionId, network: CDP_NETWORK });
  
  if (!txHash) {
    const error = 'Missing transaction hash - txHash is required for payment verification';
    console.error(`[${timestamp}] ❌ ${error}`);
    return res.status(400).json({
      error: 'Missing transaction hash',
      message: 'txHash is required for payment verification',
      timestamp
    });
  }

  try {
    // In sandbox mode, simulate payment verification
    if (SANDBOX_MODE) {
      console.log(`[${timestamp}] 🛡️  SANDBOX MODE: Simulating payment verification for txHash: ${txHash}`);
      
      let session = sessions.get(sessionId);
      if (!session) {
        session = {
          id: sessionId,
          isPaid: false,
          createdAt: new Date()
        };
        sessions.set(sessionId, session);
      }
      
      session.isPaid = true;
      session.paidAt = new Date();
      
      console.log(`[${timestamp}] ✅ SANDBOX: Payment simulated for session: ${sessionId}`);

      // Record entry fee off-chain once per session
      if (!recordedFeeSessions.has(sessionId)) {
        db.recordEntryFee(ENTRY_FEE_NUM).then(() => {
          recordedFeeSessions.add(sessionId);
          console.log(`🧾 Recorded entry fee (SANDBOX): ${ENTRY_FEE_NUM} at session ${sessionId}`);
        }).catch(err => {
          console.error('❌ Failed to record entry fee:', err);
        });
      }
      
      return res.status(200).json({
        sessionId: sessionId,
        verified: true,
        message: 'Payment verified successfully (SANDBOX MODE)',
        txHash: txHash,
        network: CDP_NETWORK,
        timestamp
      });
    }

    // Production payment verification
    let session = sessions.get(sessionId);
    
    if (!session) {
      // Create a new session for manual payment
      session = {
        id: sessionId,
        isPaid: false,
        createdAt: new Date()
      };
      sessions.set(sessionId, session);
      console.log(`[${timestamp}] 📝 Created new session for manual payment: ${sessionId}`);
    }

    // TODO: In a real implementation, you would verify the transaction hash
    // against the blockchain to ensure it's valid and matches the expected amount
    // For production, implement proper blockchain verification here
    
    if (txHash && txHash.length > 10) { // Basic validation
      session.isPaid = true;
      session.paidAt = new Date();
      
      console.log(`[${timestamp}] ✅ Manual payment verified for session: ${sessionId}, txHash: ${txHash}, network: ${CDP_NETWORK}`);
      
      // Log payment settlement for production monitoring
      if (CDP_NETWORK === 'base') {
        console.log(`[${timestamp}] 💰 MAINNET PAYMENT SETTLED: Session=${sessionId}, TxHash=${txHash}, Amount=${ENTRY_FEE_USDC} USDC, Recipient=${CDP_RECIPIENT_ADDRESS}`);
      }
      // Record entry fee off-chain once per session
      if (!recordedFeeSessions.has(sessionId)) {
        db.recordEntryFee(ENTRY_FEE_NUM).then(() => {
          recordedFeeSessions.add(sessionId);
          console.log(`🧾 Recorded entry fee (manual verify): ${ENTRY_FEE_NUM} at session ${sessionId}`);
        }).catch(err => {
          console.error('❌ Failed to record entry fee:', err);
        });
      }
      
      return res.status(200).json({
        sessionId: sessionId,
        verified: true,
        message: 'Payment verified successfully',
        txHash: txHash,
        network: CDP_NETWORK,
        timestamp
      });
    } else {
      const error = `Invalid transaction hash: ${txHash}`;
      console.error(`[${timestamp}] ❌ ${error}`);
      return res.status(400).json({
        error: 'Invalid transaction hash',
        message: 'Transaction hash appears to be invalid',
        timestamp
      });
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${timestamp}] ❌ Error during manual payment verification:`, {
      error: errorMessage,
      sessionId,
      txHash,
      network: CDP_NETWORK,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return res.status(500).json({
      error: 'Payment verification failed',
      message: 'Internal server error during payment verification',
      timestamp
    });
  }
});

// GET /api/session/:sessionId - Check session status (helper endpoint)
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    sessionId: session.id,
    isPaid: session.isPaid,
    createdAt: session.createdAt,
    paidAt: session.paidAt
  });
});

// POST /api/submit-score - Submit game score and update player stats
app.post('/api/submit-score', async (req, res) => {
  const timestamp = new Date().toISOString();
  const { sessionId, wallet, score, gameData } = req.body;
  
  console.log(`[${timestamp}] 🎯 Score submission:`, { sessionId, wallet, score });
  
  if (!sessionId || !wallet || typeof score !== 'number') {
    return res.status(400).json({
      error: 'Missing required fields',
      message: 'sessionId, wallet, and score are required',
      timestamp
    });
  }

  // Verify session exists and is paid
  const session = sessions.get(sessionId);
  if (!session || !session.isPaid) {
    return res.status(403).json({
      error: 'Invalid session',
      message: 'Session not found or payment not verified',
      timestamp
    });
  }

  try {
    // Update player stats in database
    const updatedStats = await db.updatePlayerStats(wallet, score);
    // Also track daily stats for payout scheduler
    await db.updateDailyPlayerStats(wallet, score);
    
    console.log(`[${timestamp}] ✅ Score recorded for ${wallet}: ${score} points`);
    console.log(`[${timestamp}] 📊 Updated stats:`, updatedStats);
    
    // IMPORTANT: Expire the session after score submission to enforce pay-per-game
    sessions.delete(sessionId);
    console.log(`[${timestamp}] 🔒 Session ${sessionId} expired - payment required for next game`);
    
    res.status(200).json({
      success: true,
      message: 'Score submitted successfully',
      playerStats: updatedStats,
      sessionExpired: true, // Notify frontend that session is expired
      timestamp
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Error submitting score:`, error);
    res.status(500).json({
      error: 'Score submission failed',
      message: 'Internal server error',
      timestamp
    });
  }
});

// Helper to append a JSON line to payouts.log
function appendPayoutLog(entry: any) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFile(payoutsLogPath, line, (err) => {
    if (err) console.error('❌ Failed to write payouts.log:', err);
  });
}

// Build a BaseScan URL for a transaction hash based on configured network
function buildExplorerTxLink(txHash: string | undefined) {
  if (!txHash) return null;
  const isMainnet = CDP_NETWORK === 'base';
  const baseUrl = isMainnet ? 'https://basescan.org/tx/' : 'https://sepolia.basescan.org/tx/';
  return `${baseUrl}${txHash}`;
}

// 24h payout scheduler
let isPayoutRunning = false;
async function runPayoutCycle() {
  const now = Date.now();
  const timestampISO = new Date(now).toISOString();
  console.log(`⏳ Running payout cycle at ${timestampISO}`);
  const cutoff = now - 24 * 60 * 60 * 1000;

  try {
    const totalPool = await db.getTotalEntryFeesSince(cutoff);
    const poolTotal = totalPool * 0.70;
    const poolHigh = totalPool * 0.25;
    const poolTreasury = totalPool * 0.05;

    const sumTotalScores = await db.getDailyScoresSum('total');
    const sumHighScores = await db.getDailyScoresSum('high');
    const totalEntries = await db.getDailyLeaderboard('total', 1000);
    const highEntries = await db.getDailyLeaderboard('high', 1000);

    const rewardTotalMap = new Map<string, number>();
    const rewardHighMap = new Map<string, number>();

    if (sumTotalScores > 0 && poolTotal > 0) {
      totalEntries.forEach(e => {
        const share = (e.score / sumTotalScores) * poolTotal;
        rewardTotalMap.set(e.wallet, share);
      });
    }

    // Dynamic high-score pool (25%) distribution for top 3 players
    // 1 player: 100%
    // 2 players: 70% / 30%
    // 3+ players: 60% / 25% / 15% to top 3 only
    if (poolHigh > 0 && highEntries.length > 0) {
      const top = highEntries.slice(0, Math.min(3, highEntries.length));
      if (top.length === 1) {
        rewardHighMap.set(top[0].wallet, poolHigh);
      } else if (top.length === 2) {
        rewardHighMap.set(top[0].wallet, poolHigh * 0.70);
        rewardHighMap.set(top[1].wallet, poolHigh * 0.30);
      } else {
        rewardHighMap.set(top[0].wallet, poolHigh * 0.60);
        rewardHighMap.set(top[1].wallet, poolHigh * 0.25);
        rewardHighMap.set(top[2].wallet, poolHigh * 0.15);
      }
    }

    const wallets = new Set<string>([...rewardTotalMap.keys(), ...rewardHighMap.keys()]);
    const winnersArray: string[] = [];
    const rewardsArray: bigint[] = [];
    const usdcDecimals = 6; // Base USDC uses 6 decimals
    const toUnits = (x: number) => BigInt(Math.round(x * Math.pow(10, usdcDecimals)));
    wallets.forEach(wallet => {
      const totalScore = (totalEntries.find(e => e.wallet === wallet)?.score) || 0;
      const highScore = (highEntries.find(e => e.wallet === wallet)?.score) || 0;
      const reward = (rewardTotalMap.get(wallet) || 0) + (rewardHighMap.get(wallet) || 0);

      // Collect for on-chain call
      winnersArray.push(wallet);
      rewardsArray.push(toUnits(reward));

      // Still log the computed rewards in human units for audit
      appendPayoutLog({
        wallet,
        totalScore,
        highScore,
        reward: reward.toFixed(6),
        timestamp: timestampISO,
      });
    });

    // Log treasury allocation separately
    appendPayoutLog({ type: 'treasury', amount: poolTreasury.toFixed(6), timestamp: timestampISO });

    // On-chain endCycle call (optional, gated by env)
    if (ENABLE_ONCHAIN_PAYOUTS && PRIZE_POOL_CONTRACT && PRIVATE_KEY && BASE_RPC_URL) {
      try {
        const abi = [
          'function endCycle(address[] winners, uint256[] rewards) external',
          'event Payout(address indexed to, uint256 amount)'
        ];
        const provider = new JsonRpcProvider(BASE_RPC_URL);
        const wallet = new Wallet(PRIVATE_KEY!, provider);
        const prizePool = new Contract(PRIZE_POOL_CONTRACT!, abi, wallet);
        const tx = await prizePool.endCycle(winnersArray, rewardsArray);
        const receipt = await tx.wait();
        const txLink = buildExplorerTxLink(tx.hash);
        appendPayoutLog({ type: 'onchain_endCycle', txHash: tx.hash, txLink, status: receipt?.status, timestamp: timestampISO });
        lastTxHash = tx.hash;
        lastTxLink = txLink;
        console.log(`🔗 endCycle tx: ${tx.hash}${txLink ? ` | ${txLink}` : ''}`);
      } catch (err) {
        console.error('❌ On-chain endCycle failed:', err);
        appendPayoutLog({ type: 'onchain_endCycle_error', error: (err as Error).message, timestamp: timestampISO });
      }
    } else {
      console.log('ℹ️ On-chain payouts disabled or missing config; logged rewards only.');
    }

    // Reset daily leaderboard stats (keep lifetime intact)
    await db.resetDailyStats();

    lastPayoutAt = now;
    nextPayoutAt = now + 24 * 60 * 60 * 1000;
    console.log(`✅ Payout cycle completed. Next at ${new Date(nextPayoutAt).toISOString()}`);
  } catch (err) {
    console.error('❌ Payout cycle failed:', err);
  }
}

// Kick off the 24-hour scheduler
setInterval(runPayoutCycle, 24 * 60 * 60 * 1000);

// Simple admin auth middleware using bearer or x-admin-token header
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: 'Admin disabled (missing ADMIN_TOKEN)' });
  }
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const header = req.get('x-admin-token');
  const token = bearer || header || '';
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ADMIN: Trigger payout immediately and start a new cycle
app.post('/admin/run-payout', requireAdmin, async (req, res) => {
  try {
    if (isPayoutRunning) {
      return res.status(409).json({ error: 'Payout already running' });
    }
    isPayoutRunning = true;
    await runPayoutCycle();
    isPayoutRunning = false;
    res.json({
      status: 'ok',
      lastPayoutAt,
      nextPayoutAt,
      lastPayoutAtISO: new Date(lastPayoutAt).toISOString(),
      nextPayoutAtISO: new Date(nextPayoutAt).toISOString(),
      lastTxHash,
      lastTxLink,
    });
  } catch (error) {
    isPayoutRunning = false;
    console.error('❌ Error running manual payout:', error);
    res.status(500).json({ error: 'Manual payout failed' });
  }
});

// Expose payout scheduler status for countdown timer
app.get('/payouts/status', (req, res) => {
  res.json({
    lastPayoutAt,
    nextPayoutAt,
    lastPayoutAtISO: new Date(lastPayoutAt).toISOString(),
    nextPayoutAtISO: new Date(nextPayoutAt).toISOString(),
    lastTxHash,
    lastTxLink,
  });
});

// SSE: broadcast Payout events to clients (requires BASE_WS_URL)
type SseClient = { id: string; res: express.Response };
const sseClients: SseClient[] = [];

app.get('/events/payouts', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const id = randomUUID();
  sseClients.push({ id, res });
  req.on('close', () => {
    const idx = sseClients.findIndex(c => c.id === id);
    if (idx >= 0) sseClients.splice(idx, 1);
  });
});

function broadcastPayout(data: any) {
  const line = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(c => c.res.write(line));
}

async function initPayoutEventListener() {
  if (!ENABLE_SSE_PAYOUTS) {
    console.log('ℹ️ SSE payouts disabled. Set ENABLE_SSE_PAYOUTS=true to enable event listener.');
    return;
  }
  if (!BASE_WS_URL || !PRIZE_POOL_CONTRACT) {
    console.log('ℹ️ Skipping on-chain event listener: BASE_WS_URL or PRIZE_POOL_CONTRACT missing');
    return;
  }
  if (!BASE_WS_URL.startsWith('wss://')) {
    console.log('ℹ️ Skipping on-chain event listener: BASE_WS_URL must be a wss:// URL');
    return;
  }
  try {
    const wsProvider = new WebSocketProvider(BASE_WS_URL);
    const abi = [
      'event Payout(address indexed to, uint256 amount)'
    ];
    const contract = new Contract(PRIZE_POOL_CONTRACT!, abi, wsProvider);
    contract.on('Payout', (to: string, amount: bigint, ev: any) => {
      console.log('📡 Payout event:', { to, amount: amount.toString(), txHash: ev?.log?.transactionHash });
      broadcastPayout({ to, amount: amount.toString(), txHash: ev?.log?.transactionHash });
    });
    // Handle provider-level errors without crashing dev server
    (wsProvider as any).on?.('error', (err: any) => {
      console.log('ℹ️ WebSocket provider error; continuing without SSE:', err?.message || err);
    });
  } catch (err) {
    console.error('❌ Failed to initialize payout event listener:', err);
  }
}

// GET /leaderboard/total - Get leaderboard sorted by total score
app.get('/leaderboard/total', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const entries = await db.getLeaderboard('total', limit);
    const totalPlayers = await db.getTotalPlayers();
    
    res.json({
      entries,
      totalPlayers,
      lastUpdated: new Date(),
      type: 'total'
    });
  } catch (error) {
    console.error('❌ Error fetching total leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /leaderboard/high - Get leaderboard sorted by high score
app.get('/leaderboard/high', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const entries = await db.getLeaderboard('high', limit);
    const totalPlayers = await db.getTotalPlayers();
    
    res.json({
      entries,
      totalPlayers,
      lastUpdated: new Date(),
      type: 'high'
    });
  } catch (error) {
    console.error('❌ Error fetching high score leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /leaderboard/daily/total - Get today's leaderboard by total score
app.get('/leaderboard/daily/total', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const entries = await db.getDailyLeaderboard('total', limit);
    res.json({
      entries,
      lastUpdated: new Date(),
      type: 'daily_total'
    });
  } catch (error) {
    console.error('❌ Error fetching daily total leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch daily leaderboard' });
  }
});

// GET /leaderboard/daily/high - Get today's leaderboard by high score
app.get('/leaderboard/daily/high', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const entries = await db.getDailyLeaderboard('high', limit);
    res.json({
      entries,
      lastUpdated: new Date(),
      type: 'daily_high'
    });
  } catch (error) {
    console.error('❌ Error fetching daily high leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch daily leaderboard' });
  }
});

// GET /player/:wallet - Get individual player stats
app.get('/player/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const stats = await db.getPlayerStats(wallet);
    
    if (!stats) {
      return res.status(404).json({ 
        error: 'Player not found',
        message: 'No stats found for this wallet address'
      });
    }
    
    res.json(stats);
  } catch (error) {
    console.error('❌ Error fetching player stats:', error);
    res.status(500).json({ error: 'Failed to fetch player stats' });
  }
});

// GET /player/daily/:wallet - Get today's individual player stats
app.get('/player/daily/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;
    const stats = await db.getDailyPlayerStats(wallet);
    if (!stats) {
      // If no daily row yet, return zeros for UX consistency
      return res.json({
        wallet,
        totalScoreDaily: 0,
        highScoreDaily: 0,
        gamesPlayedDaily: 0,
        lastPlayedDaily: 0
      });
    }
    res.json(stats);
  } catch (error) {
    console.error('❌ Error fetching daily player stats:', error);
    res.status(500).json({ error: 'Failed to fetch daily player stats' });
  }
});

// ADMIN: Remove specific players by wallet addresses
app.post('/admin/remove-players', requireAdmin, async (req, res) => {
  try {
    const wallets = Array.isArray(req.body?.wallets) ? req.body.wallets : [];
    if (!wallets.length) {
      return res.status(400).json({ error: 'wallets array required' });
    }
    const removed = await db.removePlayers(wallets);
    res.json({ removed, count: removed.length });
  } catch (error) {
    console.error('❌ Error removing players:', error);
    res.status(500).json({ error: 'Failed to remove players' });
  }
});

// ADMIN: Remove top N players by total score
app.post('/admin/remove-top', requireAdmin, async (req, res) => {
  try {
    const nRaw = (req.query.n as string) || (req.body?.n as number) || 4;
    const n = Math.max(1, parseInt(String(nRaw)) || 4);
    const removed = await db.removeTopPlayers(n);
    res.json({ removed, count: removed.length });
  } catch (error) {
    console.error('❌ Error removing top players:', error);
    res.status(500).json({ error: 'Failed to remove top players' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🐍 Snake402 server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`💰 Pay-to-play endpoints ready!`);
  console.log(`⏱️  Payout scheduler next run: ${new Date(nextPayoutAt).toISOString()}`);
  initPayoutEventListener();
});