import React, { useState, useEffect } from 'react';

interface LeaderboardEntry {
  wallet: string;
  totalScore?: number;
  highScore?: number;
  gamesPlayed: number;
}

interface LeaderboardProps {
  walletAddress?: string;
}

const Leaderboard: React.FC<LeaderboardProps> = ({ walletAddress }) => {
  const [totalLeaderboard, setTotalLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [highLeaderboard, setHighLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [personalStats, setPersonalStats] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextPayoutAt, setNextPayoutAt] = useState<number | null>(null);
  const [lastPayoutAt, setLastPayoutAt] = useState<number | null>(null);
  const [lastTxLink, setLastTxLink] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>('');
  const [sseConnected, setSseConnected] = useState<boolean>(false);

  const API_BASE_URL = 'http://localhost:3001';

  const fetchPayoutStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/payouts/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.nextPayoutAt === 'number') {
        setNextPayoutAt(data.nextPayoutAt);
      }
      if (typeof data.lastPayoutAt === 'number') {
        setLastPayoutAt(data.lastPayoutAt);
      }
      if (typeof data.lastTxLink === 'string') {
        setLastTxLink(data.lastTxLink);
      } else {
        setLastTxLink(null);
      }
    } catch (e) {
      // silent fail; countdown is optional
    }
  };

  const formatCountdown = (ms: number) => {
    if (ms <= 0) return '00:00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  const fetchLeaderboards = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch both leaderboards
      const [totalResponse, highResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/leaderboard/daily/total`),
        fetch(`${API_BASE_URL}/leaderboard/daily/high`)
      ]);

      if (!totalResponse.ok || !highResponse.ok) {
        throw new Error('Failed to fetch leaderboards');
      }

      const totalData = await totalResponse.json();
      const highData = await highResponse.json();

      const totalEntriesRaw = totalData.entries || totalData.leaderboard || [];
      const highEntriesRaw = highData.entries || highData.leaderboard || [];

      const normalizedTotal: LeaderboardEntry[] = totalEntriesRaw.map((e: any) => ({
        wallet: e.wallet,
        totalScore: e.score ?? e.totalScore ?? 0,
        gamesPlayed: e.gamesPlayed ?? e.games ?? 0,
      }));

      const normalizedHigh: LeaderboardEntry[] = highEntriesRaw.map((e: any) => ({
        wallet: e.wallet,
        highScore: e.score ?? e.highScore ?? 0,
        gamesPlayed: e.gamesPlayed ?? e.games ?? 0,
      }));

      setTotalLeaderboard(normalizedTotal);
      setHighLeaderboard(normalizedHigh);

      // Fetch personal stats if wallet is connected
      if (walletAddress) {
        try {
          const personalResponse = await fetch(`${API_BASE_URL}/player/daily/${walletAddress}`);
          if (personalResponse.ok) {
            const personalData = await personalResponse.json();
            setPersonalStats({
              wallet: personalData.wallet,
              totalScore: personalData.totalScoreDaily ?? 0,
              highScore: personalData.highScoreDaily ?? 0,
              gamesPlayed: personalData.gamesPlayedDaily ?? 0,
            });
          }
        } catch (err) {
          // Personal stats are optional, don't fail the whole component
          console.log('Could not fetch personal stats:', err);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboards');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboards();
    fetchPayoutStatus();
  }, [walletAddress]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (nextPayoutAt) {
        const remaining = nextPayoutAt - Date.now();
        setCountdown(formatCountdown(remaining));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [nextPayoutAt]);

  // Subscribe to server-sent payout events; refresh leaderboards on event
  useEffect(() => {
    const es = new EventSource(`${API_BASE_URL}/events/payouts`);
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);
    es.onmessage = () => {
      // Any payout event should refresh both leaderboards
      fetchLeaderboards();
      fetchPayoutStatus();
    };
    return () => es.close();
  }, []);

  const formatWallet = (wallet: string) => {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  };

  // We now show both leaderboards at once; no active tab.

  if (loading) {
    return (
      <div className="leaderboard-container">
        <h3>🏆 Today's Leaderboard</h3>
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="leaderboard-container">
        <h3>🏆 Today's Leaderboard</h3>
        <div className="error">Error: {error}</div>
        <button onClick={fetchLeaderboards} className="retry-button">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="leaderboard-container">
      <h3>🏆 Today's Leaderboard</h3>
      {nextPayoutAt && (
        <div style={{ marginBottom: 12, color: '#9aa2aa' }}>
          ⏱️ Next payout in <strong style={{ color: '#cbd5e1' }}>{countdown}</strong>{sseConnected ? ' • Live' : ''}
        </div>
      )}
      {lastPayoutAt && (
        <div style={{ marginBottom: 12, color: '#9aa2aa' }}>
          ✅ Last payout: <strong style={{ color: '#cbd5e1' }}>{new Date(lastPayoutAt).toLocaleString()}</strong>
          {lastTxLink ? (
            <>
              {' '}• <a href={lastTxLink} target="_blank" rel="noreferrer" style={{ color: '#0d6efd' }}>View on BaseScan</a>
            </>
          ) : null}
        </div>
      )}
      
      {/* Personal Stats */}
      {personalStats && (
        <div className="personal-stats">
          <h4>Today's Stats</h4>
          <div className="stats-grid">
            <div className="stat">
              <span className="stat-label">Today's Games:</span>
              <span className="stat-value">{personalStats.gamesPlayed}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Today's Total Score:</span>
              <span className="stat-value">{personalStats.totalScore}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Today's High Score:</span>
              <span className="stat-value">{personalStats.highScore}</span>
            </div>
          </div>
        </div>
      )}

      {/* Leaderboards Side by Side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24 }}>
        <div>
          <h4 style={{ color: '#9aa2aa', marginBottom: 8 }}>🏆 Total Score</h4>
          <div className="leaderboard-list">
            {totalLeaderboard.length === 0 ? (
              <div className="empty-leaderboard">No players yet. Be the first to play!</div>
            ) : (
              totalLeaderboard.map((entry, index) => (
                <div
                  key={`total-${entry.wallet}`}
                  className={`leaderboard-entry ${entry.wallet === walletAddress ? 'current-player' : ''}`}
                >
                  <div className="rank">#{index + 1}</div>
                  <div className="player-info">
                    <div className="wallet">{formatWallet(entry.wallet)}</div>
                    <div className="games">Games: {entry.gamesPlayed}</div>
                  </div>
                  <div className="score">{entry.totalScore}</div>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <h4 style={{ color: '#9aa2aa', marginBottom: 8 }}>🔥 High Score</h4>
          <div className="leaderboard-list">
            {highLeaderboard.length === 0 ? (
              <div className="empty-leaderboard">No players yet. Be the first to play!</div>
            ) : (
              highLeaderboard.map((entry, index) => (
                <div
                  key={`high-${entry.wallet}`}
                  className={`leaderboard-entry ${entry.wallet === walletAddress ? 'current-player' : ''}`}
                >
                  <div className="rank">#{index + 1}</div>
                  <div className="player-info">
                    <div className="wallet">{formatWallet(entry.wallet)}</div>
                    <div className="games">Games: {entry.gamesPlayed}</div>
                  </div>
                  <div className="score">{entry.highScore}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <button onClick={fetchLeaderboards} className="refresh-button">
        🔄 Refresh
      </button>
    </div>
  );
};

export default Leaderboard;