import { createConfig, http } from 'wagmi'
import { baseSepolia, base } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    // Prefer MetaMask over other injected wallets
    metaMask(),
    injected({ target: 'metaMask' }),
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});