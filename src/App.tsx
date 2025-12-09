import { useEffect, useState } from 'react'
import tezlinkLogo from './assets/XTZ.png'
import './App.css'
import { TezosToolkit, type Signer } from '@taquito/taquito';
import { b58cdecode, b58decode, prefix } from '@taquito/utils';
import {
  DefaultDataProvider,
  TokenBridge,
  TaquitoWalletTezosBridgeBlockchainService,
  Web3EtherlinkBridgeBlockchainService,
  type TokenPair,
  type NativeTezosToken,
} from '@baking-bad/tezos-etherlink-bridge-sdk'
import { BeaconWallet } from '@taquito/beacon-wallet';
import { NetworkType } from '@airgap/beacon-types'
import Web3 from 'web3';
import { SigningType } from '@airgap/beacon-dapp';
import { Buffer } from 'buffer';
import RLP from 'rlp';
import CircularProgress from '@mui/material/CircularProgress';
(window as any).global = window;
(window as any).Buffer = Buffer;



class BeaconSigner implements Signer {
  wallet: BeaconWallet;

  constructor(wallet: BeaconWallet) {
    this.wallet = wallet;
  }

  // Required methods of the Signer interface:
  async publicKey(): Promise<string> {
    const account = await this.wallet.client.getActiveAccount();
    if (!account) throw new Error('No active account');
    return account.publicKey!;
  }

  async publicKeyHash(): Promise<string> {
    const account = await this.wallet.client.getActiveAccount();
    if (!account) throw new Error('No active account');
    return account.address;
  }

  async secretKey(): Promise<string | undefined> {
    // Wallets never expose secret keys
    return undefined;
  }

  async sign(bytes: string, _magicByte?: Uint8Array): Promise<{
    bytes: string;
    sig: string;
    prefixSig: string;
    sbytes: string;
  }> {
    // Use the wallet to sign the bytes
    const signed = await this.wallet.client.requestSignPayload({
      signingType: SigningType.OPERATION,
      payload: "03" + bytes,
    });
    const sigHex = Buffer.from(b58cdecode(signed.signature, prefix.edsig)).toString('hex');
    return {
      bytes,
      sig: sigHex,
      prefixSig: signed.signature,
      sbytes: bytes + sigHex,
    };
  }
}


function App() {

  const toNetworkType = (value: string): NetworkType | undefined =>
    Object.values(NetworkType).includes(value as NetworkType)
      ? (value as NetworkType)
      : undefined;

  // Use MetaMask
  const web3 = new Web3();

  let tezosRpcUrl = 'https://rpc.tzkt.io/';
  let network = NetworkType.SHADOWNET;
  const env_network = toNetworkType(import.meta.env.VITE_NETWORK);
  const endpoint = import.meta.env.VITE_ENDPOINT;

  if (env_network !== undefined) {
    network = env_network;
    if (network == NetworkType.CUSTOM) {
      // If network is custom user should give an endpoint
      if (endpoint !== undefined) {
        tezosRpcUrl = endpoint;
      } else {
        console.log('No endpoint given despite a custom network, switching to shadownet')
        network = NetworkType.SHADOWNET;
        tezosRpcUrl += network;
      }
    } else {
      tezosRpcUrl += env_network;
    }
  } else {
    console.log('Network is unparsable, switching to default network: ' + env_network)
    tezosRpcUrl += network;
  }

  const TezosToken: NativeTezosToken = {
    type: 'native',
  };

  const options = {
    name: 'Tezlink Bridge',
    iconUrl: tezlinkLogo,
    preferredNetwork: network,
    enableMetrics: true,
  };

  const wallet = new BeaconWallet(options);

  let deposit_contract = 'KT1JmSDcDPyBzFCJ2uTzqKhCtpRvxARzjDrh'
  const env_deposit_contract = import.meta.env.VITE_CONTRACT;

  if (env_deposit_contract !== undefined) {
    deposit_contract = env_deposit_contract;
  }

  // Native
  const tokenPairs: TokenPair[] =
    [{
      tezos: {
        type: 'native',
        ticketHelperContractAddress: deposit_contract,
      },
      etherlink: {
        type: 'native',
      }
    }];

  let tzkt = 'https://api.shadownet.tzkt.io';

  if (network == NetworkType.CUSTOM) {
    const env_tzkt = import.meta.env.VITE_TZKT;
    if (env_tzkt !== undefined) {
      tzkt = env_tzkt;
    } else {
      console.log('No tzkt api provided despite a custom network, switching to shadownet');
      network = NetworkType.SHADOWNET;
      tezosRpcUrl = `https://rpc.tzkt.io/${network}`;
    }
  } else {
    tzkt = `https://api.${network}.tzkt.io`;
  }


  const defaultDataProvider = new DefaultDataProvider({
    dipDup: {
      baseUrl: 'https://testnet.bridge.indexer.etherlink.com',
      webSocketApiBaseUrl: 'wss://testnet.bridge.indexer.etherlink.com'
    },
    tzKTApiBaseUrl: tzkt,
    etherlinkRpcUrl: 'https://node.ghostnet.etherlink.com',
    tokenPairs
  })

  const [am, setAmount] = useState('');
  const [amountMessage, setamountMessage] = useState<string>('');
  const [balance, setBalance] = useState<string>('');
  const [address, setAddress] = useState<string>('');

  let tezosToolkit = new TezosToolkit(tezosRpcUrl);

  let rollup = 'sr1M1Gn31bcNHkyLXqpJAG4XWdJEPagiYQZx';
  const env_rollup = import.meta.env.VITE_ROLLUP;
  if (env_rollup !== undefined) {
    rollup = env_rollup;
  }

  const tokenBridge = new TokenBridge({
    tezosBridgeBlockchainService: new TaquitoWalletTezosBridgeBlockchainService({
      tezosToolkit: tezosToolkit,
      smartRollupAddress: rollup
    }),
    etherlinkBridgeBlockchainService: new Web3EtherlinkBridgeBlockchainService({
      web3
    }),
    bridgeDataProviders: {
      transfers: defaultDataProvider,
      balances: defaultDataProvider,
      tokens: defaultDataProvider,
    }
  });

  const verify_validity = (amount: string) => {
    if (address == '') {
      setamountMessage("Please connect a wallet first")
      return false;
    }
    let numAmount = Number(amount);
    let numBalance = Number(balance);
    if (Number.isNaN(numAmount)) {
      setamountMessage("Please use a valid amount")
      return false;
    } else if (numAmount > numBalance) {
      setamountMessage("You can't deposit more than your balance")
      return false;
    } else if (numAmount < 0) {
      setamountMessage("You can't deposit a negative amount")
      return false;
    } else {
      setamountMessage('')
      return true;
    }
  }


  const connectWallet = async () => {
    await wallet.requestPermissions();


    const userAddress = await wallet.getPKH();

    setamountMessage('');
    setAddress(userAddress);
  };

  const fetchBalance = async () => {
    console.log("Fetch the balance of the address connected");
    if (address == '') {
      setBalance('');
      return;
    }

    try {
      const mutez = await tezosToolkit.tz.getBalance(address);
      const xtz = mutez.toNumber() / 1_000_000;

      setBalance(xtz.toString());
      console.log("Balance has been set");
    } catch (err) {
      console.error("Erreur balance", err);
      setBalance('');
    }
  };

  useEffect(() => {
    fetchBalance();
  }, [address]);

  const [load, setLoad] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {

    e.preventDefault();

    if (!verify_validity(am)) {
      return;
    }

    let numAmount = Number(am);
    let addr = b58decode(address);
    const data = Buffer.from(addr, 'hex');
    let array = RLP.encode([[1, data], []]);
    const hex = Buffer.from(array).toString('hex');
    let mutez = numAmount * 1_000_000;

    tezosToolkit.setWalletProvider(wallet);
    tezosToolkit.setSignerProvider(new BeaconSigner(wallet));

    const { tokenTransfer: _, operationResult } = await tokenBridge.deposit(BigInt(mutez), TezosToken, "01" + hex);
    setLoad(true);

    let result = await operationResult.operation.confirmation(3);

    setLoad(!result?.completed);
    fetchBalance()
  };

  return (
    <>
      <h1>Tezlink Bridge</h1>
      <div style={{ maxWidth: '400px', margin: '2rem auto', fontFamily: 'sans-serif' }}>
        <form onSubmit={handleSubmit}>

          <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-4 w-full max-w-md">
            {/* Header: Token + Network */}
            <div className="flex justify-between pb-3 border-b border-neutral-700">
              <div className="flex items-center gap-2">
                <img src={tezlinkLogo} alt="XTZ" className="w-6 h-6" />
                <div className="flex flex-col">
                  <span className="text-sm text-neutral-400">Token</span>
                  <span className="text-white font-medium flex items-center gap-1">
                    XTZ
                  </span>
                </div>
              </div>

              <div className="flex flex-col text-right">
                <span className="text-sm text-neutral-400">Network</span>
                <span className="text-white font-medium">Tezlink</span>
              </div>
            </div>

            {/* Amount line */}
            <div className="flex justify-between items-center mt-4">
              <button type="button"
                className="px-3 py-1 text-sm bg-neutral-800 hover:bg-neutral-700 
                     border border-neutral-600 rounded-md text-neutral-300"
                onClick={() => {
                  setAmount(balance)
                }}
              >
                Max
              </button>
              <div>
                {/* Input */}
                <input
                  type="text"
                  value={am}
                  onChange={(e) => {
                    if (address == '') {
                      setamountMessage("Please connect a wallet first")
                      return;
                    } else {
                      let amount = e.target.value;
                      verify_validity(amount)
                      setAmount(amount);
                    }
                  }}
                  placeholder="0"
                  className="flex-1 bg-transparent text-xl text-neutral-200 
                     placeholder-neutral-500 outline-none"
                />

                {amountMessage && (
                  <p className="text-red-600">{amountMessage}</p>
                )}
              </div>
              {/* Balance */}
              <div className="flex flex-col text-left">
                <span className="text-sm text-neutral-400">Balance</span>
                <span className="text-white ml-1">{balance !== '' ? balance : "-"}</span>
              </div>
            </div>
          </div>

          {load ? <CircularProgress /> : <button type="submit" style={{ padding: '10px 16px', cursor: 'pointer' }}>
            Send ꜩ
          </button>}
        </form>
        {address !== '' ? <div className="text-neutral-500 text-sm">Connected</div> : <button onClick={connectWallet} className="bg-red-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-full">
          Connect wallet
        </button>
        }
      </div>
    </>
  )
}

export default App
