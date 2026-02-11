import { http, createConfig } from 'wagmi';
import { monadTestnet } from './chains';
import { injected, walletConnect } from 'wagmi/connectors';

// WalletConnect Project ID al: https://cloud.walletconnect.com
const projectId = 'a70ed85d01dbff2c2d46f92f6538c810';

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    injected(), // MetaMask, Coinbase vb.
    walletConnect({ projectId }),
  ],
  transports: {
    [monadTestnet.id]: http(),
  },
});