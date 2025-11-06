# Snake402 Production Deployment Guide

## 🚨 Important Security Notice

This application handles real USDC transactions on Base Mainnet. Follow all security guidelines carefully.

## Prerequisites

1. **Production Coinbase Developer Platform Account**
   - Create account at https://portal.cdp.coinbase.com/
   - Generate production API keys
   - Verify your identity and complete KYC if required

2. **Secure Wallet Setup**
   - Treasury wallet: Secure multisig or hardware wallet for receiving payments
   - Facilitator wallet: Dedicated operational wallet with minimal funds

3. **Infrastructure Requirements**
   - HTTPS-enabled domain
   - SSL certificate
   - Reverse proxy (nginx, Cloudflare, etc.)
   - Process manager (PM2, systemd, etc.)

## Environment Configuration

1. **Copy the production template:**
```bash
cp .env.production.template .env
```

2. **Fill in production values:**
- `CDP_API_KEY_ID`: Your production CDP API key ID
- `CDP_API_KEY_SECRET`: Your production CDP API key secret
- `CDP_RECIPIENT_ADDRESS`: Your secure treasury wallet address
- `PRIVATE_KEY`: Dedicated facilitator wallet private key
- `SANDBOX_MODE`: Set to `false` for real transactions
 - `PRIZE_POOL_CONTRACT`: Deployed PrizePool address (see Remix section)
 - `USDC_CONTRACT`: Base USDC token address (mainnet: `0x833589fCD6EDB6E08f4c7d8b9A55B41C89d5bE1E`)
 - `TREASURY_ADDRESS`: Your treasury wallet address
 - `ENABLE_ONCHAIN_PAYOUTS`: `true` to call endCycle on-chain
 - `BASE_RPC_URL`: Base JSON-RPC endpoint (e.g., `https://mainnet.base.org`)
 - `BASE_WS_URL` (optional): Base WebSocket endpoint for live events

## Build and Deploy

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Build the application:**
   ```bash
   pnpm build
   ```

3. **Start production server:**
   ```bash
pnpm start
```

## Smart Contract (Remix)

Use Remix to deploy `contracts/PrizePool.sol` on Base.

### Steps
- Open https://remix.ethereum.org
- Create a file `contracts/PrizePool.sol` and paste the contract source from this repo.
- In "Solidity Compiler":
  - Version: `0.8.20`
  - Optimization: Enabled (e.g., 200 runs)
- In "Deploy & Run Transactions":
  - Environment: `Injected Provider - MetaMask`
  - Network: Base Mainnet (`chainId 8453`) or Base Sepolia for testing (`chainId 84532`)
  - Constructor args:
    - `USDC_CONTRACT`: Base USDC address
    - `TREASURY_ADDRESS`: Your treasury wallet
  - Deploy and confirm in MetaMask

### After Deploy
- Copy the deployed address and set in `.env`:
  - `PRIZE_POOL_CONTRACT=0xYourDeployedAddress`
- Ensure server env is configured:
  - `PRIVATE_KEY`: Must be the deployer/owner address; only owner can call `endCycle`
  - `ENABLE_ONCHAIN_PAYOUTS=true`
  - `BASE_RPC_URL=https://mainnet.base.org` (or provider URL)
  - `USDC_CONTRACT=0x833589f...`
  - `TREASURY_ADDRESS=0x...`
- Restart the server so x402 routes entry fees to the contract and the 24h scheduler can call `endCycle`.

### Verification
- View the contract on BaseScan and check:
  - `owner()` equals your deployer address
  - `usdc()` and `treasury()` reflect constructor values
- Optionally verify source on BaseScan using the same compiler and optimization settings.

### Remix Import Notes
- The contract imports `@openzeppelin/contracts/token/ERC20/IERC20.sol`.
- If Remix cannot resolve npm imports:
  - In Remix, install the library via the Libraries panel (`@openzeppelin/contracts@5.x`), or
  - Temporarily replace the import with a minimal local interface:

```solidity
// contracts/IERC20.sol (fallback for Remix only)
pragma solidity ^0.8.20;
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
```

Then update the import in `PrizePool.sol` during Remix deployment:

```solidity
import "./IERC20.sol";
```

Note: Keep the original OpenZeppelin import in the repository; use the fallback only inside Remix if needed.

## HTTPS Configuration

**Critical:** The application MUST run over HTTPS in production for security.

### Option 1: Reverse Proxy (Recommended)
Configure nginx or similar to handle SSL termination:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    
    ssl_certificate /path/to/certificate.crt;
    ssl_certificate_key /path/to/private.key;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Option 2: Cloudflare
Use Cloudflare's SSL/TLS encryption for easy HTTPS setup.

## Security Checklist

- [ ] Production API keys configured
- [ ] Treasury wallet is secure (multisig/hardware)
- [ ] Facilitator wallet has minimal funds
- [ ] HTTPS enabled
- [ ] Environment variables secured
- [ ] `.env` file not committed to git
- [ ] Server monitoring enabled
- [ ] Transaction alerts configured
- [ ] Backup and recovery plan in place

## Monitoring and Alerts

1. **Transaction Monitoring:**
   - Monitor treasury wallet for incoming payments
   - Set up alerts for unusual transaction patterns
   - Log all payment verifications

2. **Server Monitoring:**
   - Monitor server health and uptime
   - Track API response times
   - Monitor error rates

3. **Security Monitoring:**
   - Monitor for failed authentication attempts
   - Track unusual API usage patterns
   - Set up alerts for high-value transactions

## Testing Before Production

1. **Testnet Verification:**
   ```bash
   # Use .env.development for testnet testing
   cp .env.development .env
   pnpm dev
   ```

2. **Production Dry Run:**
   ```bash
   # Set SANDBOX_MODE=true in production .env
   SANDBOX_MODE=true
   pnpm start
   ```

3. **Small Transaction Test:**
   - Start with minimal entry fee
   - Test with small amounts first
   - Verify all payment flows work correctly

## Troubleshooting

### Common Issues:

1. **Payment Verification Fails:**
   - Check network connectivity to Base RPC
   - Verify transaction hash format
   - Check recipient address matches

2. **API Key Issues:**
   - Verify API keys are for production environment
   - Check API key permissions
   - Ensure keys are properly formatted

3. **Network Issues:**
   - Confirm `CDP_NETWORK=base` for mainnet
   - Check RPC endpoint connectivity
   - Verify chain ID matches Base Mainnet (8453)

## Support

For technical issues:
1. Check server logs for error details
2. Verify all environment variables are set correctly
3. Test network connectivity to Base Mainnet
4. Review Coinbase Developer Platform documentation

## Emergency Procedures

If you need to stop the service immediately:
1. Stop the server process
2. Set `SANDBOX_MODE=true` to prevent real transactions
3. Investigate the issue before restarting
4. Consider temporarily redirecting traffic if needed