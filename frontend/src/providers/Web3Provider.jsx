import { createWeb3Modal } from '@web3modal/wagmi/react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '../config/wagmi';
import { monadTestnet } from '../config/chains';

const queryClient = new QueryClient();

// Web3Modal oluştur
createWeb3Modal({
    wagmiConfig: config,
    projectId: 'a70ed85d01dbff2c2d46f92f6538c810',
    chains: [monadTestnet],
    themeMode: 'dark',
});

export function Web3Provider({ children }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </WagmiProvider>
    );
}
