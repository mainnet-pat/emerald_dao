import '@/styles/globals.css'
import { Input, Output, TransactionBCH } from '@bitauth/libauth'
import type { AppProps } from 'next/app'
import { AbiFunction, Artifact } from 'cashscript';

export interface ContractInfo {
  contract?: {
    abiFunction: AbiFunction;
    redeemScript: Uint8Array;
    artifact: Partial<Artifact>;
  }
}

declare global {
  interface Window {
    paytaca?: {
      address: (assetId?: string) => Promise<string | undefined>;
      signTransaction: (options: {assetId?: string, transaction: string | TransactionBCH, sourceOutputs: (Input | Output | ContractInfo)[], broadcast?: boolean, userPrompt?: string}) => Promise<{ signedTransaction: string, signedTransactionHash: string} | undefined>;
      signMessage: (options: {assetId?: string, message: string, userPrompt?: string}) => Promise<string | undefined>;
      connect: () => Promise<void>;
      connected: () => Promise<boolean>;
      disconnect: () => Promise<void>;
      on(event: string, callback: Function): void;
      on(event: "addressChanged", callback: Function): void;
    }
  }
}

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
