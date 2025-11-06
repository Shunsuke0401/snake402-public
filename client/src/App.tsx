import React, { useEffect, useRef, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAccount, useEnsName, useConnect, useDisconnect, useWaitForTransactionReceipt, useWriteContract, useReadContract, useWalletClient, useChainId, useSwitchChain } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';
import { createWalletClient, custom } from 'viem';
import { parseEther, parseUnits } from 'viem';
import { base } from 'wagmi/chains';
import { config } from './wagmi';
import { GameScene } from './GameScene';
import { UIScene } from './UIScene';
import { wrapFetchWithPayment, decodeXPaymentResponse } from 'x402-fetch';
import Leaderboard from './Leaderboard';

const queryClient = new QueryClient();

// Custom Connect Button Component
const CustomConnectButton: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { data: ensName } = useEnsName({ address });
  const { connect, connectors, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [showConnectors, setShowConnectors] = useState(false);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const displayName = ensName || (address ? formatAddress(address) : '');

  // Log connection errors
  useEffect(() => {
    if (error) {
      console.error('Connection error:', error);
    }
  }, [error]);

  if (isConnected) {
    return (
      <div className="wallet-connected">
        <div className="connected-info">
          <span className="wallet-display">Connected: {displayName}</span>
          <button 
            className="disconnect-button"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-connect">
      <button 
        className="connect-button"
        onClick={() => setShowConnectors(!showConnectors)}
      >
        Connect Wallet
      </button>
      {error && (
        <div style={{ color: 'red', fontSize: '12px', marginTop: '5px' }}>
          Error: {error.message}
        </div>
      )}
      {showConnectors && (
        <div className="connectors-dropdown">
          {connectors.map((connector) => (
            <button
              key={connector.id}
              className="connector-button"
              onClick={() => {
                console.log('Attempting to connect with:', connector.name);
                connect({ connector });
                setShowConnectors(false);
              }}
            >
              {connector.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// API Configuration
const API_BASE_URL = 'http://localhost:3001/api';

// Network detection utility
const detectNetworkMode = async (): Promise<'mainnet' | 'testnet' | 'unknown'> => {
  try {
    const response = await fetch(`${API_BASE_URL}`);
    const data = await response.json();
    
    // Check if the response contains network information
    if (data.networkMode === 'mainnet') {
      return 'mainnet';
    } else if (data.networkMode === 'testnet') {
      return 'testnet';
    }
    
    return 'unknown';
  } catch (error) {
    console.error('Failed to detect network mode:', error);
    return 'unknown';
  }
};



// Payment state interface
interface PaymentInfo {
  sessionId: string;
  amount: string;
  asset: string;
  recipient: string;
  network: string;
  description: string;
  tokenAddress: string; // Add token contract address
}

// Game component that handles Phaser integration
const GameComponent: React.FC = () => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const { address, isConnected } = useAccount();
  const { data: ensName } = useEnsName({ address });
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [page, setPage] = useState<'home' | 'leaderboard'>('home');
  

  
  // Payment state
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<string>('');
  
  // Transaction hooks for ERC-20 token transfer
  const { writeContract, data: txHash, isPending: isTxPending, error: txError } = useWriteContract();
  const { isLoading: isTxConfirming, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Check USDC balance
  const { data: usdcBalance } = useReadContract({
    address: paymentInfo?.tokenAddress as `0x${string}`,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }]
      }
    ],
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!paymentInfo?.tokenAddress && !!address
    }
  });

  // Store wallet info in memory for later use
  const [walletInfo, setWalletInfo] = useState<{
    address?: string;
    ensName?: string;
  }>({});

  useEffect(() => {
    console.log('Wallet state changed:', { isConnected, address, ensName });
    if (isConnected && address) {
      setWalletInfo({
        address,
        ensName: ensName || undefined,
      });
    } else {
      setWalletInfo({});
      setIsGameStarted(false);
      setPaymentInfo(null);
    }
  }, [isConnected, address, ensName]);



  // Handle transaction success
  useEffect(() => {
    if (isTxSuccess && txHash && paymentInfo) {
      console.log('=== Transaction Confirmed ===');
      console.log('Transaction hash:', txHash);
      console.log('Block explorer URL:', `https://basescan.org/tx/${txHash}`);
      console.log('Waiting 2 seconds before verifying with server...');
      
      // Add a small delay to ensure the blockchain state is propagated
      setTimeout(() => {
        joinGameWithPayment(txHash);
      }, 2000); // Wait 2 seconds after confirmation
    }
  }, [isTxSuccess, txHash, paymentInfo]);

  // Handle transaction error
  useEffect(() => {
    if (txError) {
      console.error('Transaction error:', txError);
      setPaymentStatus(`Transaction failed: ${txError.message}`);
      setIsProcessingPayment(false);
    }
  }, [txError]);

  // API Functions
  const joinGame = async (clientOverride?: any): Promise<{ success: boolean; error?: string; paymentInfo?: PaymentInfo }> => {
    const effectiveClient = clientOverride || walletClient;
    if (!effectiveClient) {
      return { success: false, error: 'Wallet client not available' };
    }

    try {
      console.log('🎮 Attempting to join game...');
      
      // First try with x402-fetch
      const fetchWithPayment = wrapFetchWithPayment(fetch, effectiveClient as any);
      
      const response = await fetchWithPayment(`${API_BASE_URL}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Game access granted:', data);
        
        // Check for payment response header
        const paymentResponseHeader = response.headers.get('x-payment-response');
        if (paymentResponseHeader) {
          const paymentResponse = decodeXPaymentResponse(paymentResponseHeader);
          console.log('💳 Payment completed:', paymentResponse);
        }
        
        return { success: true };
      } else if (response.status === 402) {
        // Handle 402 Payment Required manually
        console.log('💳 Payment required - handling manually');
        const paymentData = await response.json();
        console.log('💳 Payment data:', paymentData);
        
        // Extract payment information from the 402 response
        if (paymentData.accepts && paymentData.accepts.length > 0) {
          const paymentOption = paymentData.accepts[0];
          
          const paymentInfo = {
            sessionId: `session_${Date.now()}`, // Generate a session ID
            amount: (Number(paymentOption.maxAmountRequired) / 1e6).toString(), // Convert from wei to USDC
            asset: paymentOption.extra?.name || 'USDC',
            recipient: paymentOption.payTo,
            network: paymentOption.network,
            description: paymentOption.description,
            tokenAddress: paymentOption.asset
          };
          
          return { success: false, error: 'Payment required', paymentInfo };
        } else {
          return { success: false, error: 'Invalid payment response format' };
        }
      } else {
        throw new Error(`Unexpected response: ${response.status}`);
      }
    } catch (error) {
      console.error('Join game error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      };
    }
  };

  const joinGameWithPayment = async (transactionHash: string) => {
    try {
      console.log('Verifying payment with transaction hash:', transactionHash);
      setPaymentStatus('Verifying payment with server...');
      
      // Use the verify-payment endpoint instead of the x402-protected join endpoint
      const response = await fetch(`${API_BASE_URL}/verify-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          txHash: transactionHash,
          sessionId: paymentInfo?.sessionId || `session_${Date.now()}`
        })
      });

      console.log('Payment verification response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        console.log('Payment verification successful:', data);
        setPaymentStatus('Payment verified! Starting game...');
        setPaymentInfo(null);
        setIsProcessingPayment(false);
        
        // Start the game after a short delay
        setTimeout(() => {
          startGameCountdown();
        }, 1000);
      } else {
        let errorMessage = 'Unknown error';
        try {
          const errorData = await response.json();
          console.error('Payment verification failed:', errorData);
          errorMessage = errorData.error || errorData.message || JSON.stringify(errorData);
        } catch (parseError) {
          console.error('Failed to parse error response:', parseError);
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        setPaymentStatus(`Payment verification failed: ${errorMessage}`);
        setIsProcessingPayment(false);
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      setPaymentStatus(`Payment verification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessingPayment(false);
    }
  };



  // Handle game-active class on body
  useEffect(() => {
    if (isGameStarted) {
      document.body.classList.add('game-active');
    } else {
      document.body.classList.remove('game-active');
    }
    
    // Cleanup on unmount
    return () => {
      document.body.classList.remove('game-active');
    };
  }, [isGameStarted]);

  // Handle escape key to exit game
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isGameStarted) {
        stopGame();
      }
    };

    const handleResize = () => {
      if (gameRef.current && isGameStarted) {
        gameRef.current.scale.resize(window.innerWidth, window.innerHeight);
        // Also notify the GameScene to reposition itself
        const gameScene = gameRef.current.scene.getScene('GameScene') as any;
        if (gameScene && gameScene.resize) {
          gameScene.resize(window.innerWidth, window.innerHeight);
        }
      }
    };

    if (isGameStarted) {
      document.addEventListener('keydown', handleKeyPress);
      window.addEventListener('resize', handleResize);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      window.removeEventListener('resize', handleResize);
    };
  }, [isGameStarted]);

  const stopGame = () => {
    if (gameRef.current) {
      gameRef.current.destroy(true);
      gameRef.current = null;
    }
    setIsGameStarted(false);
    setPaymentInfo(null);
    setPaymentStatus('');
  };

  const handleSessionExpired = () => {
    console.log('Session expired - clearing payment info to require new payment');
    setPaymentInfo(null);
    setPaymentStatus('Session expired. Payment required for next game.');
  };

  // Ensure wallet client is ready by preferring hook client, requesting accounts,
  // polling Wagmi actions, and falling back to a direct Viem wallet client.
  const ensureWalletClientReady = async (requiredChainId: number, maxWaitMs = 8000): Promise<any | null> => {
    try {
      // Prefer the existing hook client if it already has an account on the required chain
      if (walletClient && walletClient.account && walletClient.account.address && walletClient.chain?.id === requiredChainId) {
        return walletClient as any;
      }

      // Select MetaMask provider explicitly when multiple injected providers exist
      const eth = typeof window !== 'undefined' ? (window as any).ethereum : undefined;
      let selectedProvider: any = eth;
      if (eth?.providers?.length) {
        selectedProvider = eth.providers.find((p: any) => p.isMetaMask) ?? eth.providers[0];
      }

      // Prompt the selected provider to ensure accounts are available (no-op if already connected)
      if (selectedProvider) {
        try {
          await selectedProvider.request({ method: 'eth_requestAccounts' });
        } catch (e) {
          // Ignore user rejection here; we'll still attempt to get the client
          console.warn('eth_requestAccounts rejected or failed:', e);
        }
      }

      // Check the current provider chain and switch if mismatched
      let currentChainId: number | undefined;
      if (selectedProvider) {
        try {
          const chainHex = await selectedProvider.request({ method: 'eth_chainId' });
          if (typeof chainHex === 'string') {
            currentChainId = parseInt(chainHex, 16);
          }
        } catch (e) {
          console.warn('eth_chainId failed:', e);
        }
        if (currentChainId && currentChainId !== requiredChainId) {
          try {
            const hexId = `0x${requiredChainId.toString(16)}`;
            await selectedProvider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: hexId }],
            });
            currentChainId = requiredChainId;
          } catch (e) {
            console.warn('Provider chain switch failed:', e);
          }
        }
      }

      // Try to read current accounts (may help with direct Viem fallback)
      let accounts: string[] = [];
      if (selectedProvider) {
        try {
          const res = await selectedProvider.request({ method: 'eth_accounts' });
          if (Array.isArray(res)) accounts = res as string[];
        } catch (e) {
          console.warn('eth_accounts failed:', e);
        }
      }

      const start = Date.now();
      let effectiveClient: any | null = null;
      while (Date.now() - start < maxWaitMs) {
        try {
          effectiveClient = await getWalletClient(config, { chainId: requiredChainId });
        } catch (e) {
          effectiveClient = null;
        }
        if (effectiveClient && effectiveClient.account && effectiveClient.account.address) {
          return effectiveClient;
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      // As a last resort, create a direct Viem wallet client using the EIP-1193 provider
      if (selectedProvider && accounts && accounts[0]) {
        try {
          const fallbackClient = createWalletClient({
            chain: base,
            transport: custom(selectedProvider),
            account: accounts[0] as `0x${string}`,
          });
          if ((fallbackClient as any)?.account?.address) {
            return fallbackClient as any;
          }
        } catch (e) {
          console.warn('Direct Viem wallet client fallback failed:', e);
        }
      }

      return null;
    } catch (err) {
      console.error('ensureWalletClientReady error:', err);
      return null;
    }
  };

  const handlePlayClick = async () => {
    console.log('Play button clicked, isConnected:', isConnected);
    if (!isConnected) {
      setPaymentStatus('Please connect your wallet first');
      return;
    }

    // Check if we're on the correct network (Base mainnet)
    console.log('Current chainId:', chainId, 'Expected:', base.id);
    if (chainId !== base.id) {
      setPaymentStatus('Switching to Base mainnet...');
      try {
        await switchChain({ chainId: base.id });
        setPaymentStatus('Network switched successfully. Preparing wallet connection...');
      } catch (error) {
        console.error('Failed to switch network:', error);
        // Fallback: try direct provider switch
        try {
          const eth = typeof window !== 'undefined' ? (window as any).ethereum : undefined;
          const provider = eth?.providers?.length ? eth.providers.find((p: any) => p.isMetaMask) ?? eth.providers[0] : eth;
          if (provider) {
            const hexId = `0x${base.id.toString(16)}`;
            await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
            setPaymentStatus('Network switched via provider. Preparing wallet connection...');
          } else {
            setPaymentStatus(`Please switch to Base mainnet manually. Current network: ${chainId}, Required: ${base.id}`);
            return;
          }
        } catch (e) {
          console.error('Direct provider switch failed:', e);
          setPaymentStatus(`Please switch to Base mainnet manually. Current network: ${chainId}, Required: ${base.id}`);
          return;
        }
      }
    }

    // Ensure a fresh wallet client is available for the payment handshake
    setPaymentStatus('Preparing wallet connection...');
    const effectiveClient = await ensureWalletClientReady(base.id, 5000);
    if (!effectiveClient) {
      setPaymentStatus('Wallet client not ready. Please disconnect and reconnect your wallet.');
      return;
    }

    setPaymentStatus('Checking game access...');
    
    try {
      const result = await joinGame(effectiveClient);
      
      if (result.success) {
        // Game access granted - x402-fetch handled payment automatically
        startGameCountdown();
      } else if (result.error === 'Payment required' && result.paymentInfo) {
        // Payment is required - set payment info and automatically trigger payment process
        setPaymentInfo(result.paymentInfo);
        setPaymentStatus('Payment required. Initiating payment...');
        await handleAutoPayment(result.paymentInfo);
      } else {
        setPaymentStatus(result.error || 'Failed to join game. Please try again.');
      }
    } catch (error) {
      setPaymentStatus('Network error. Please try again.');
    }
  };

  const handleAutoPayment = async (paymentInfoParam?: PaymentInfo) => {
    const currentPaymentInfo = paymentInfoParam || paymentInfo;
    
    if (!currentPaymentInfo || !address) {
      setPaymentStatus('Missing payment information or wallet address');
      return;
    }

    setIsProcessingPayment(true);
    setPaymentStatus('Processing payment automatically...');

    try {
      const transferAmount = parseUnits(currentPaymentInfo.amount, 6);
      
      console.log('=== Auto Payment - ERC-20 Transfer Details ===');
      console.log('Token Contract:', currentPaymentInfo.tokenAddress);
      console.log('From (your wallet):', address);
      console.log('To (recipient):', currentPaymentInfo.recipient);
      console.log('Amount (raw):', currentPaymentInfo.amount);
      console.log('Amount (parsed with 6 decimals):', transferAmount.toString());
      console.log('Network:', currentPaymentInfo.network);
      
      // Check USDC balance
      if (usdcBalance !== undefined) {
        const balanceFormatted = Number(usdcBalance) / 1e6; // Convert from wei to USDC (6 decimals)
        const requiredAmount = Number(currentPaymentInfo.amount);
        
        console.log('=== Auto Payment - Balance Check ===');
        console.log('Your USDC balance:', balanceFormatted, 'USDC');
        console.log('Required amount:', requiredAmount, 'USDC');
        console.log('Balance sufficient:', balanceFormatted >= requiredAmount);
        
        if (balanceFormatted < requiredAmount) {
          setPaymentStatus(`Insufficient USDC balance. You have ${balanceFormatted} USDC but need ${requiredAmount} USDC.`);
          setIsProcessingPayment(false);
          return;
        }
      } else {
        console.log('⚠️ Could not fetch USDC balance - proceeding anyway');
      }
      
      // ERC-20 token transfer using writeContract
      writeContract({
        address: currentPaymentInfo.tokenAddress as `0x${string}`,
        abi: [
          {
            name: 'transfer',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }]
          }
        ],
        functionName: 'transfer',
        args: [currentPaymentInfo.recipient as `0x${string}`, transferAmount]
      });
      
    } catch (error) {
      console.error('Auto payment error:', error);
      setPaymentStatus(`Auto payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessingPayment(false);
    }
  };

  const handlePayClick = async () => {
    if (!paymentInfo || !address) {
      setPaymentStatus('Missing payment information or wallet address');
      return;
    }

    setIsProcessingPayment(true);
    setPaymentStatus('Preparing transaction...');

    try {
      const transferAmount = parseUnits(paymentInfo.amount, 6);
      
      console.log('=== ERC-20 Transfer Details ===');
      console.log('Token Contract:', paymentInfo.tokenAddress);
      console.log('From (your wallet):', address);
      console.log('To (recipient):', paymentInfo.recipient);
      console.log('Amount (raw):', paymentInfo.amount);
      console.log('Amount (parsed with 6 decimals):', transferAmount.toString());
      console.log('Network:', paymentInfo.network);
      
      // Check USDC balance
      if (usdcBalance !== undefined) {
        const balanceFormatted = Number(usdcBalance) / 1e6; // Convert from wei to USDC (6 decimals)
        const requiredAmount = Number(paymentInfo.amount);
        
        console.log('=== Balance Check ===');
        console.log('Your USDC balance:', balanceFormatted, 'USDC');
        console.log('Required amount:', requiredAmount, 'USDC');
        console.log('Balance sufficient:', balanceFormatted >= requiredAmount);
        
        if (balanceFormatted < requiredAmount) {
          setPaymentStatus(`Insufficient USDC balance. You have ${balanceFormatted} USDC but need ${requiredAmount} USDC.`);
          setIsProcessingPayment(false);
          return;
        }
      } else {
        console.log('⚠️ Could not fetch USDC balance - proceeding anyway');
      }
      
      // ERC-20 token transfer using writeContract
      writeContract({
        address: paymentInfo.tokenAddress as `0x${string}`,
        abi: [
          {
            name: 'transfer',
            type: 'function',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' }
            ],
            outputs: [{ name: '', type: 'bool' }]
          }
        ],
        functionName: 'transfer',
        args: [
          paymentInfo.recipient as `0x${string}`,
          transferAmount
        ]
      });
      
      setPaymentStatus('Please confirm the transaction in your wallet...');
    } catch (error) {
      console.error('Payment error:', error);
      setPaymentStatus('Payment failed. Please try again.');
      setIsProcessingPayment(false);
    }
  };

  const startGameCountdown = () => {
    setCountdown(3);
    
    const countdownInterval = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(countdownInterval);
          // Actually start the game after countdown
          setIsGameStarted(true);
          setCountdown(null);
          
          if (!gameRef.current) {
            const gameConfig: Phaser.Types.Core.GameConfig = {
              type: Phaser.AUTO,
              width: window.innerWidth,
              height: window.innerHeight,
              parent: 'game-container',
              backgroundColor: '#2c3e50',
              scale: {
                mode: Phaser.Scale.RESIZE,
                autoCenter: Phaser.Scale.CENTER_BOTH,
              },
              scene: [GameScene, UIScene],
              physics: {
                default: 'arcade',
                arcade: {
                  gravity: { x: 0, y: 0 },
                  debug: false
                }
              }
            };

            gameRef.current = new Phaser.Game(gameConfig);
            
            // Pass the stopGame callback to UIScene after game is created
            setTimeout(() => {
              const uiScene = gameRef.current?.scene.getScene('UIScene') as any;
              if (uiScene && uiScene.scene.isActive()) {
                uiScene.scene.restart({ 
                  goHomeCallback: stopGame,
                  walletAddress: walletInfo.address,
                  sessionId: paymentInfo?.sessionId,
                  onSessionExpired: handleSessionExpired
                });
              }
            }, 100);
          }
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  return (
    <>
      <div className="app">

        {/* Wallet Connection Overlay */}
        <div className="wallet-overlay">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '12px' }}>
            <button
              className="leaderboard-button"
              onClick={() => setPage(page === 'leaderboard' ? 'home' : 'leaderboard')}
              style={{
                background: page === 'leaderboard' ? '#0d6efd' : '#6c757d',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 'bold'
              }}
            >
              {page === 'leaderboard' ? 'Home' : "Today's Leaderboard"}
            </button>
            <div style={{ marginLeft: 'auto' }}>
              <CustomConnectButton />
            </div>
          </div>
        </div>

        {/* Home Screen */}
        {!isGameStarted && !countdown && page === 'home' && (
          <div className="home-screen">
            <div className="home-content">
              <h1>Snake402</h1>
              <p>Pay-to-play Snake game on Base Mainnet!</p>
              
              {/* Payment Status */}
              {paymentStatus && (
                <div className="payment-status" style={{
                  background: paymentInfo ? 'rgba(255,193,7,0.2)' : 'rgba(0,123,255,0.2)',
                  border: `1px solid ${paymentInfo ? '#ffc107' : '#007bff'}`,
                  padding: '10px',
                  margin: '10px 0',
                  borderRadius: '5px',
                  fontSize: '14px'
                }}>
                  {paymentStatus}
                </div>
              )}

              {/* Payment UI */}
              {paymentInfo && (
                <div className="payment-info" style={{
                  background: 'rgba(255,255,255,0.1)',
                  padding: '20px',
                  margin: '20px 0',
                  borderRadius: '10px',
                  border: '2px solid #ffc107'
                }}>
                  <h3>Payment Required</h3>
                  <p><strong>Amount:</strong> {paymentInfo.amount} {paymentInfo.asset}</p>
                  <p><strong>Network:</strong> {paymentInfo.network}</p>
                  <p><strong>Token:</strong> USDC (Base)</p>
                  <p><strong>Contract:</strong> <code style={{ fontSize: '11px', background: 'rgba(0,0,0,0.3)', padding: '2px 4px', borderRadius: '3px' }}>{paymentInfo.tokenAddress}</code></p>
                  <p style={{ fontSize: '12px', color: '#ffc107', marginTop: '5px' }}>
                    ℹ️ Using official USDC contract address. The token may show as "unknown" in MetaMask if you haven't added USDC to your token list.
                  </p>
                  <p><strong>Description:</strong> {paymentInfo.description}</p>
                  
                  <button 
                    className="pay-button"
                    onClick={handlePayClick}
                    disabled={isProcessingPayment || isTxPending || isTxConfirming}
                    style={{
                      background: isProcessingPayment || isTxPending || isTxConfirming ? '#666' : '#28a745',
                      color: 'white',
                      border: 'none',
                      padding: '12px 24px',
                      borderRadius: '8px',
                      cursor: isProcessingPayment || isTxPending || isTxConfirming ? 'not-allowed' : 'pointer',
                      fontSize: '16px',
                      marginTop: '10px'
                    }}
                  >
                    {isTxPending ? 'Confirming...' : 
                     isTxConfirming ? 'Processing...' : 
                     isProcessingPayment ? 'Processing...' : 
                     'Pay to Play'}
                  </button>
                </div>
              )}
              
              
              
              {isConnected && !paymentInfo ? (
                <button 
                  className="play-button" 
                  onClick={handlePlayClick}
                  style={{
                    background: '#007bff',
                    color: 'white',
                    border: 'none',
                    padding: '15px 30px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '18px',
                    fontWeight: 'bold'
                  }}
                >
                  Play Snake402
                </button>
              ) : !isConnected ? (
                <p className="connect-message">Please connect your wallet above to continue</p>
              ) : null}
            </div>
            
            
          </div>
        )}

        {/* Leaderboard Page */}
        {!isGameStarted && !countdown && page === 'leaderboard' && (
          <div className="leaderboard-page">
            <Leaderboard walletAddress={address} />
          </div>
        )}

        {/* Countdown Screen */}
        {countdown && (
          <div className="countdown-screen">
            <div className="countdown-content">
              <h1>Get Ready!</h1>
              <div className="countdown-number">{countdown}</div>
            </div>
          </div>
        )}
      </div>

      {/* Game Container - Rendered outside of .app to avoid pointer-events conflicts */}
      {isGameStarted && (
        <>
          <button className="game-close-button" onClick={stopGame} title="Press ESC or click to exit">
            ×
          </button>
          <div id="game-container"></div>
        </>
      )}
    </>
  );
};

const App: React.FC = () => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <GameComponent />
      </QueryClientProvider>
    </WagmiProvider>
  );
};

export default App;