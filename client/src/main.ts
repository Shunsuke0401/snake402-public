import Phaser from 'phaser';
import { GameScene } from './GameScene';
import { UIScene } from './UIScene';

// API Configuration
const API_BASE_URL = 'http://localhost:3001/api';

// Game state
let currentSessionId: string | null = null;
let isWalletConnected = false;
let game: Phaser.Game | null = null;

// Phaser game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 700,
  parent: 'phaser-game',
  backgroundColor: '#2c3e50',
  scene: [GameScene, UIScene],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  }
};

// UI Elements
const connectWalletButton = document.getElementById('connect-wallet-button') as HTMLButtonElement;
const playButton = document.getElementById('play-button') as HTMLButtonElement;
const payButton = document.getElementById('pay-button') as HTMLButtonElement;
const paymentInfo = document.getElementById('payment-info') as HTMLDivElement;
const sessionIdSpan = document.getElementById('session-id') as HTMLSpanElement;
const paymentAmountSpan = document.getElementById('payment-amount') as HTMLSpanElement;
const statusContainer = document.getElementById('status-container') as HTMLDivElement;
const homeScreen = document.getElementById('home-screen') as HTMLDivElement;
const gameScreen = document.getElementById('game-screen') as HTMLDivElement;

// Utility functions
function showStatus(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const statusDiv = document.createElement('div');
  statusDiv.className = `status-message status-${type}`;
  statusDiv.textContent = message;
  
  statusContainer.innerHTML = '';
  statusContainer.appendChild(statusDiv);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (statusDiv.parentNode) {
      statusDiv.parentNode.removeChild(statusDiv);
    }
  }, 5000);
}

function setButtonLoading(button: HTMLButtonElement, loading: boolean, originalText?: string) {
  if (loading) {
    button.disabled = true;
    button.textContent = 'Loading...';
  } else {
    button.disabled = false;
    button.textContent = originalText || button.textContent;
  }
}

// API functions
async function joinGame(): Promise<{ success: boolean; sessionId?: string; paymentRequired?: boolean; amount?: number; currency?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (response.status === 402) {
      // Payment required
      const data = await response.json();
      return {
        success: false,
        paymentRequired: true,
        sessionId: data.sessionId,
        amount: data.amount,
        currency: data.currency
      };
    } else if (response.status === 200) {
      // Payment already verified (shouldn't happen in our current flow)
      const data = await response.json();
      return {
        success: true,
        sessionId: data.sessionId
      };
    } else {
      throw new Error(`Unexpected response: ${response.status}`);
    }
  } catch (error) {
    console.error('Join game error:', error);
    return { success: false };
  }
}

async function verifyPayment(sessionId: string, txId: string): Promise<{ success: boolean; sessionId?: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        txId
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        sessionId: data.sessionId
      };
    } else {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Payment verification failed');
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    return { success: false };
  }
}

// Event handlers
async function handleConnectWallet() {
  setButtonLoading(connectWalletButton, true, 'Connect Wallet');
  
  try {
    // Simulate wallet connection (fake implementation)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    isWalletConnected = true;
    connectWalletButton.style.display = 'none';
    playButton.style.display = 'inline-block';
    
    showStatus('Wallet connected successfully!', 'success');
  } catch (error) {
    showStatus('Failed to connect wallet', 'error');
  } finally {
    setButtonLoading(connectWalletButton, false, 'Connect Wallet');
  }
}

async function handlePlayClick() {
  if (!isWalletConnected) {
    showStatus('Please connect your wallet first', 'error');
    return;
  }

  setButtonLoading(playButton, true, 'Play Snake402');
  showStatus('Checking game access...', 'info');

  try {
    const result = await joinGame();
    
    if (result.paymentRequired && result.sessionId) {
      // Show payment UI
      currentSessionId = result.sessionId;
      sessionIdSpan.textContent = result.sessionId;
      paymentAmountSpan.textContent = `${result.amount} ${result.currency}`;
      paymentInfo.style.display = 'block';
      
      showStatus('Payment required to play', 'info');
    } else if (result.success && result.sessionId) {
      // Game access granted (shouldn't happen in current flow)
      currentSessionId = result.sessionId;
      startGame();
    } else {
      showStatus('Failed to join game. Please try again.', 'error');
    }
  } catch (error) {
    showStatus('Network error. Please try again.', 'error');
  } finally {
    setButtonLoading(playButton, false, 'Play Snake402');
  }
}

async function handlePayClick() {
  if (!currentSessionId) {
    showStatus('No active session. Please try again.', 'error');
    return;
  }

  setButtonLoading(payButton, true, 'Pay to Play');
  showStatus('Processing payment...', 'info');

  try {
    // Generate fake transaction ID
    const fakeTransactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Simulate payment processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result = await verifyPayment(currentSessionId, fakeTransactionId);
    
    if (result.success) {
      showStatus('Payment verified! Starting game...', 'success');
      paymentInfo.style.display = 'none';
      
      // Start the game after a short delay
      setTimeout(() => {
        startGame();
      }, 1000);
    } else {
      showStatus('Payment verification failed. Please try again.', 'error');
    }
  } catch (error) {
    showStatus('Payment processing failed. Please try again.', 'error');
  } finally {
    setButtonLoading(payButton, false, 'Pay to Play');
  }
}

function startGame() {
  // Hide home screen and show game screen
  homeScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  
  // Initialize Phaser game
  if (!game) {
    game = new Phaser.Game(config);
  }
  
  // Start the game scene
  game.scene.start('GameScene');
  
  showStatus('Game started! Enjoy playing Snake402!', 'success');
}

// Initialize event listeners
function initializeEventListeners() {
  connectWalletButton.addEventListener('click', handleConnectWallet);
  playButton.addEventListener('click', handlePlayClick);
  payButton.addEventListener('click', handlePayClick);
}

// Initialize the application
function initialize() {
  console.log('Snake402 client initialized!');
  console.log('Pay-to-play flow ready!');
  
  initializeEventListeners();
  
  // Show initial status
  showStatus('Welcome to Snake402! Connect your wallet to get started.', 'info');
}

// Start the application
initialize();