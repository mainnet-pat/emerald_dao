import dynamic from 'next/dynamic'
import Head from 'next/head'
import styles from '@/styles/Home.module.css'
import { DefaultProvider, Network, TestNetWallet, UtxoI, Wallet, hexToBin } from 'mainnet-js'
import { useCallback, useEffect, useState } from 'react';
import { Contract } from '@mainnet-cash/contract';
import { CashAddressNetworkPrefix, CashAddressType, binToHex, binToNumberInt32LE, binToNumberUint16LE, cashAddressToLockingBytecode, decodeCashAddress, decodeTransaction, encodeCashAddress } from '@bitauth/libauth';
import { SignatureTemplate, Utxo } from 'cashscript';
import Image from 'next/image';
import { Artifact, scriptToBytecode, sha256 } from '@cashscript/utils';

const isActivated = true;

const WalletClass = isActivated ? Wallet : TestNetWallet;

DefaultProvider.servers.testnet = ["wss://blackie.c3-soft.com:64004"];

export const toCashScript = (utxo: UtxoI) =>
  ({
    satoshis: BigInt(utxo.satoshis),
    txid: utxo.txid,
    vout: utxo.vout,
    token: utxo.token
      ? ({
          amount: utxo.token?.amount ? BigInt(utxo.token.amount) : 0n,
          category: utxo.token?.tokenId,
          nft:
            utxo.token?.capability || utxo.token?.commitment
              ? ({
                  capability: utxo.token?.capability,
                  commitment: utxo.token?.commitment,
                })
              : undefined,
        })
      : undefined,
  } as Utxo);


export default dynamic(() => Promise.resolve(() => {
  if (!window.paytaca) {
    return (
      <div>Paytaca plugin is not installed or not supported by your browser</div>
    )
  }

  // const [tokenId, setTokenId] = useState<string | null>(localStorage.getItem("tokenId"));
  const [tokenId, setTokenId] = useState<string | null>(daoId);
  const [connectedAddress, setConnectedAddress] = useState<string | null>();
  // const [contractAddress, setContractAddress] = useState<string | null>( localStorage.getItem("contractAddress"));
  const [contractAddress, setContractAddress] = useState<string | null>(vaultContract.getDepositAddress());
  const [contractTokenAddress, setContractTokenAddress] = useState<string | null>(localStorage.getItem("contractTokenAddress"));
  const [walletBalance, setWalletBalance] = useState<number | null>();
  const [contractBalance, setContractBalance] = useState<number | null>();
  const [tokens, setTokens] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [mintedAmount, setMintedAmount] = useState<number>(0);
  const [mintCost, setMintCost] = useState<number>(daoChildSafeboxNominalValue);

  useEffect(() => {
    (async () => {
      if (!contractAddress) {
        return
      }

      const contractWallet = await WalletClass.watchOnly(contractAddress);

      const contractUtxo = (await contractWallet.getAddressUtxos()).find(val => val.token?.tokenId === tokenId)!;
      const mintedAmount = Number("0x" + swapEndianness(contractUtxo.token?.commitment));
      setMintedAmount(mintedAmount);
      setContractBalance(contractUtxo.satoshis);

      contractWallet.provider.watchAddressStatus(contractAddress!, async () => {
        const contractUtxo = (await contractWallet.getAddressUtxos()).find(val => val.token?.tokenId === tokenId)!;
        const mintedAmount = Number("0x" + swapEndianness(contractUtxo.token?.commitment));
        setMintedAmount(mintedAmount);
        setContractBalance(contractUtxo.satoshis);
      });
    })()
  }, [tokenId, setMintedAmount, setContractBalance, contractAddress]);

  window.paytaca.on("addressChanged", (address: string) => {
    setConnectedAddress("");
  });

  useEffect(() => {
    (async () => {
      if (!connectedAddress) {
        const connected = await window.paytaca?.connected();
        if (connected) {
          let address = await window.paytaca?.address("bch");
          if (!isActivated) {
            const decoded = decodeCashAddress(address!);
            if (typeof decoded === "string") {
              setError(decoded);
              setTimeout(() => setError(""), 10000);
              return;
            }
            address = encodeCashAddress(CashAddressNetworkPrefix.testnet, CashAddressType.p2pkh, decoded.payload);
          }
          setConnectedAddress(address);
        }
        return;
      }

      const connectedWallet = await WalletClass.watchOnly(connectedAddress!);
      const utxos = await connectedWallet.getAddressUtxos();
      setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));

      const tokenUtxos = utxos.filter(utxo => utxo.token?.tokenId === tokenId).sort((a, b) => binToNumberUint16LE(hexToBin(a.token!.commitment!)) - binToNumberUint16LE(hexToBin(b.token!.commitment!)));
      setTokens(tokenUtxos.map(val => val.token!.commitment!));

      connectedWallet.provider.watchAddressStatus(connectedAddress!, async () => {
        const utxos = await connectedWallet.getAddressUtxos();
        setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));

        });
    })();
  }, [connectedAddress, tokenId, setWalletBalance, setTokens]);

  const connect = useCallback(async () => {
    await window.paytaca!.connect();
    let connectedAddress = await window.paytaca!.address("bch");
    if (!connectedAddress) {
      setError("User denied connection request");
      setTimeout(() => setError(""), 10000);
      return;
    }

    if (!isActivated) {
      const decoded = decodeCashAddress(connectedAddress);
      if (typeof decoded === "string") {
        setError(decoded);
        setTimeout(() => setError(""), 10000);
        return;
      }
      connectedAddress = encodeCashAddress(CashAddressNetworkPrefix.testnet, CashAddressType.p2pkh, decoded.payload);
    }

    setConnectedAddress(connectedAddress);
  }, [setConnectedAddress]);

  const disconnect = useCallback(async () => {
    await window.paytaca!.disconnect();
    setConnectedAddress(null);
    setTokens([]);
  }, [setConnectedAddress]);

  const donate = useCallback(async () =>
  {
    const userWallet = await WalletClass.watchOnly(connectedAddress!);

    const txfee = 800;

    const donation = 10000000;

    let daoInput: Utxo = {} as any;
    const daoUtxos = await vaultContract.getUtxos();
    for (let i=0; i<daoUtxos.length; i++) {
      if (daoUtxos[i].token?.tokenId == daoId) {
        daoInput = toCashScript(daoUtxos[i]);
        break;
      }
    }

    const userUtxos = (await userWallet.getAddressUtxos()).map(toCashScript).filter(
      val => !val.token && val.satoshis >= (donation + txfee + 500),
    );
    const userInput = userUtxos[0];
    if (!userInput) {
      setError("No suitable utxos found for donation. Try to consolidate your utxos!");
      setTimeout(() => setError(""), 10000);
      return;
    }
    const userSig = new SignatureTemplate(Uint8Array.from(Array(32)));

    const func = vaultContract.getContractFunction("OnlyOne");
    const transaction = func().from(daoInput).fromP2PKH(userInput, userSig).to([
      // contract pass-by
      {
        to: vaultContract.getTokenDepositAddress(),
        amount: BigInt(Number(daoInput.satoshis) + donation),
        token: daoInput.token,
      }
    ]).withoutTokenChange().withHardcodedFee(BigInt(txfee));

    (transaction as any).locktime = 0;
    await transaction.build();
    (transaction as any).outputs[1].to = userWallet.cashaddr;
    (transaction as any).outputs[1].amount = (transaction as any).outputs[1].amount - 500n;

    const decoded = decodeTransaction(hexToBin(await transaction.build()));
    if (typeof decoded === "string") {
      setError(decoded);
      setTimeout(() => setError(""), 10000);
      return;
    }
    decoded.inputs[1].unlockingBytecode = Uint8Array.from([]);

    const bytecode = (transaction as any).redeemScript;
    const artifact = {...vaultContract.artifact} as Partial<Artifact>;
    delete artifact.source;
    delete artifact.bytecode;

    const signResult = await window.paytaca!.signTransaction({
      transaction: decoded,
      sourceOutputs: [{
        ...decoded.inputs[0],
        lockingBytecode: (cashAddressToLockingBytecode(contractAddress!) as any).bytecode,
        valueSatoshis: BigInt(daoInput.satoshis),
        token: daoInput.token && {
          ...daoInput.token,
          category: hexToBin(daoInput.token.category),
          nft: daoInput.token.nft && {
            ...daoInput.token.nft,
            commitment: hexToBin(daoInput.token.nft.commitment),
          },
        },
        contract: {
          abiFunction: (transaction as any).abiFunction,
          redeemScript: scriptToBytecode(bytecode),
          artifact: artifact,
        }
      }, {
        ...decoded.inputs[1],
        lockingBytecode: (cashAddressToLockingBytecode(connectedAddress!) as any).bytecode,
        valueSatoshis: BigInt(userInput.satoshis),
      }],
      broadcast: false,
      userPrompt: "Donate BCH to DAO's reward pool"
    });

    if (signResult === undefined) {
      setError("User rejected the transaction signing request");
      setTimeout(() => setError(""), 10000);
      return;
    }

    try {
      await userWallet.submitTransaction(hexToBin(signResult.signedTransaction), true);
    } catch (e) {
      if ((e as any).message.indexOf('txn-mempool-conflict (code 18)') !== -1) {
        setError("Someone already extended the same DAO UTXO, please try again with the next one");
        setTimeout(() => setError(""), 10000);
        return;
      } else {
        console.trace(e);
        setError((e as any).message);
        setTimeout(() => setError(""), 10000);
        return;
      }
    }

    {
      const utxos = await userWallet.getAddressUtxos();
      setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));

      const tokenUtxos = utxos.filter(utxo => utxo.token?.tokenId === tokenId).sort((a, b) => binToNumberUint16LE(hexToBin(a.token!.commitment!)) - binToNumberUint16LE(hexToBin(b.token!.commitment!)));
      setTokens(tokenUtxos.map(val => val.token!.commitment!));
    }
  }, [tokenId, contractAddress, connectedAddress, setWalletBalance, setTokens]);

  const mint = useCallback(async () =>
  {

    const userWallet = await WalletClass.watchOnly(connectedAddress!);

    const txfee = 800;

    let daoInput: Utxo = {} as any;
    const daoUtxos = await vaultContract.getUtxos();
    for (let i=0; i<daoUtxos.length; i++) {
      if (daoUtxos[i].token?.tokenId == daoId) {
        daoInput = toCashScript(daoUtxos[i]);
        break;
      }
    }

    const lastMinted = Number("0x" + swapEndianness(daoInput.token?.nft?.commitment));
    const leftToMint = daoMaxSafeboxes - lastMinted;
    const availableRewards = Number(daoInput.satoshis) - daoDustLimit - daoExecutorFee;
    const allotedReward = Math.floor(Math.max(0, availableRewards) / leftToMint);

    const nextCommitment = binToHex(binToFixedLength(numberToBinUintLE(lastMinted + 1), 2));
    const satsToLock = daoChildSafeboxNominalValue + allotedReward;
    const keycardCommitment = nextCommitment + binToHex(binToFixedLength(numberToBinUintLE(satsToLock), 8));

    const userUtxos = (await userWallet.getAddressUtxos()).map(toCashScript).filter(
      val => !val.token && val.satoshis >= (Number(daoDustLimit) * 2 + Number(daoChildSafeboxNominalValue) + txfee + 500),
    );
    const userInput = userUtxos[0];
    if (!userInput) {
      setError("No suitable utxos found for mint. Try to consolidate your utxos!");
      setTimeout(() => setError(""), 10000);
      return;
    }
    const userSig = new SignatureTemplate(Uint8Array.from(Array(32)));

    const func = vaultContract.getContractFunction("OnlyOne");
    const transaction = func().from(daoInput).fromP2PKH(userInput, userSig).to([
      // contract pass-by
      {
        to: vaultContract.getTokenDepositAddress(),
        amount: BigInt(Number(daoInput.satoshis) - allotedReward),
        token: {
          category: daoInput.token?.category!,
          amount: BigInt(0),
          nft: {
            capability: "minting",
            commitment: nextCommitment,
          },
        },
      },
      // user's new NFT
      {
        to: userWallet.getTokenDepositAddress(),
        amount: BigInt(Number(daoDustLimit)),
        token: {
          category: daoInput.token?.category!,
          amount: BigInt(0),
          nft: {
            capability: "none",
            commitment: keycardCommitment,
          },
        },
      },
      // safebox NFT
      {
        to: safeboxContract.getTokenDepositAddress(),
        amount: BigInt(satsToLock),
        token: {
          category: daoInput.token?.category!,
          amount: BigInt(0),
          nft: {
            capability: "none",
            commitment: nextCommitment,
          },
        },
      },
    ]).withoutTokenChange().withHardcodedFee(BigInt(txfee));

    (transaction as any).locktime = 0;
    await transaction.build();
    (transaction as any).outputs[3].to = userWallet.cashaddr;
    (transaction as any).outputs[3].amount = (transaction as any).outputs[3].amount - 500n;

    const decoded = decodeTransaction(hexToBin(await transaction.build()));
    if (typeof decoded === "string") {
      setError(decoded);
      setTimeout(() => setError(""), 10000);
      return;
    }
    decoded.inputs[1].unlockingBytecode = Uint8Array.from([]);

    const bytecode = (transaction as any).redeemScript;
    const artifact = {...vaultContract.artifact} as Partial<Artifact>;
    delete artifact.source;
    delete artifact.bytecode;

    const signResult = await window.paytaca!.signTransaction({
      transaction: decoded,
      sourceOutputs: [{
        ...decoded.inputs[0],
        lockingBytecode: (cashAddressToLockingBytecode(contractAddress!) as any).bytecode,
        valueSatoshis: BigInt(daoInput.satoshis),
        token: daoInput.token && {
          ...daoInput.token,
          category: hexToBin(daoInput.token.category),
          nft: daoInput.token.nft && {
            ...daoInput.token.nft,
            commitment: hexToBin(daoInput.token.nft.commitment),
          },
        },
        contract: {
          abiFunction: (transaction as any).abiFunction,
          redeemScript: scriptToBytecode(bytecode),
          artifact: artifact,
        }
      }, {
        ...decoded.inputs[1],
        lockingBytecode: (cashAddressToLockingBytecode(connectedAddress!) as any).bytecode,
        valueSatoshis: BigInt(userInput.satoshis),
      }],
      broadcast: false,
      userPrompt: "Mint new NFT"
    });

    if (signResult === undefined) {
      setError("User rejected the transaction signing request");
      setTimeout(() => setError(""), 10000);
      return;
    }

    try {
      await userWallet.submitTransaction(hexToBin(signResult.signedTransaction), true);
    } catch (e) {
      if ((e as any).message.indexOf('txn-mempool-conflict (code 18)') !== -1) {
        setError("Someone was faster than you at minting this NFT, please try again with the next one");
        setTimeout(() => setError(""), 10000);
        return;
      } else {
        console.trace(e);
        setError((e as any).message);
        setTimeout(() => setError(""), 10000);
        return;
      }
    }

    {
      const utxos = await userWallet.getAddressUtxos();
      setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));

      const tokenUtxos = utxos.filter(utxo => utxo.token?.tokenId === tokenId).sort((a, b) => binToNumberUint16LE(hexToBin(a.token!.commitment!)) - binToNumberUint16LE(hexToBin(b.token!.commitment!)));
      setTokens(tokenUtxos.map(val => val.token!.commitment!));
    }
  }, [tokenId, contractAddress, connectedAddress, setWalletBalance, setTokens]);

  const consolidate = useCallback(async () => {
    const userWallet = await WalletClass.watchOnly(connectedAddress!);
    const response = await userWallet.sendMax(connectedAddress!, { buildUnsigned: true });

    const decoded = decodeTransaction(hexToBin(response.unsignedTransaction!));
    if (typeof decoded === "string") {
      setError(decoded);
      setTimeout(() => setError(""), 10000);
      return;
    }

    const signResult = await window.paytaca!.signTransaction({
      transaction: decoded,
      sourceOutputs: response.sourceOutputs!,
      broadcast: false,
      userPrompt: "Sign to consolidate"
    });

    if (signResult === undefined) {
      setError("User rejected the transaction signing request");
      setTimeout(() => setError(""), 10000);
      return;
    }

    try {
      await userWallet.submitTransaction(hexToBin(signResult.signedTransaction), true);
    } catch (e) {
      console.trace(e);
      setError((e as any).message);
      setTimeout(() => setError(""), 10000);
      return;
    }

    {
      const utxos = await userWallet.getAddressUtxos();
      setWalletBalance(utxos.reduce((prev, cur) => cur.satoshis + prev, 0));
    }
  }, [connectedAddress]);

  const signMessage = useCallback(async (message: string) => {
    const signedMessage = await window.paytaca!.signMessage({message, userPrompt: "Sign this test message"});
    if (signedMessage === undefined) {
      setError("User rejected the message signing request");
      setTimeout(() => setError(""), 10000);
      return;
    } else {
      console.log(signedMessage)
    }
  }, []);

  return (
    <>
      <Head>
        <title>Emerald DAO</title>
        <meta name="description" content="" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className={`w-full flex justify-center flex-col md:flex-row mb-1`}>
        <div>
          Brought to you by
        </div>
        <div>
          <a href='https://twitter.com/bchautist' rel="noreferrer" className="text-sky-700 ml-1" target='_blank'>bitcoincashautist</a> (contract)
        </div>
        <div>
          <a href='https://twitter.com/mainnet_pat' rel="noreferrer" className="text-sky-700 ml-1" target='_blank'>mainnet_pat</a> (UI, Paytaca integration)
        </div>
      </div>

      <main className={styles.main + "mt-10 lg:mt-0 p-[1rem] lg:px-[30%]"}>
        <h1 className="flex justify-center mb-3 text-xl font-bold">Emerald DAO</h1>
        <h2 className="flex justify-center mb-3 text-md font-bold">Lock your funds and receive an NFT!</h2>

        {error.length > 0 && <div className="flex text-lg justify-center text-red-500">{error}</div>}

        {contractAddress && <div>
          Minting Contract address: <div>{ contractAddress }</div>
          <div>Max NFT Amount: {maxAmount}. { mintedAmount != maxAmount && `Mint Cost: ${mintCost / 1e8} BCH.` } Minted amount: {mintedAmount}. {(mintedAmount == maxAmount) && <strong>Minting is over</strong> }</div>
          Contract Balance: <div>{ (contractBalance ?? 0) / 1e8 } BCH</div>
        </div>}

        <hr className='my-5'/>

        {!connectedAddress &&
          <div className='flex flex-row gap-5 items-center'>
            <div>Please connect with Paytaca</div>
            <div>
              <button type="button" onClick={() => connect()} className="inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out">Connect</button>
            </div>
          </div>
        }

        {connectedAddress && <>
          Connected wallet: <div>{ connectedAddress }</div>
          Balance: <div>{ (walletBalance ?? 0) / 1e8 } BCH { walletBalance === 0 && <span>Get some tBCH on <a rel="noreferrer" className="text-sky-700" href='http://tbch.googol.cash' target='_blank'>http://tbch.googol.cash</a>, select chipnet</span>} </div>
          <div className='flex flex-row flex-wrap gap-5'>
            {contractAddress && <div>
              <button type="button" onClick={() => mint()} disabled={maxAmount === mintedAmount} className={`inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out ${maxAmount === mintedAmount ? "line-through" : ""}`}>Mint new NFT</button>
            </div>}
            {contractAddress && <div>
              <button type="button" onClick={() => donate()} disabled={maxAmount === mintedAmount} className={`inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out ${maxAmount === mintedAmount ? "line-through" : ""}`}>Donate 0.1 BCH to DAO's reward pool</button>
            </div>}
            <div>
              <button type="button" onClick={() => disconnect()} className="inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out">Disconnect paytaca</button>
            </div>
          </div>
        </>}

        {tokens.length > 0 && <>
          Your tokens:
          <div className="flex flex-row gap-3 flex-wrap">
            {tokens.map(commitment =>
              <div key={commitment}>
                <div className="flex flex-col items-center">
                  <Image src="https://ipfs.pat.mn/ipfs/QmcNL1KcVmiDtwJe8WokrnzYeoHirsz1sNxNojncsxyb2p" alt={commitment} width="128" height="128" />
                  <hr className={`mt-1 border-solid border-2 w-[128px]`} style={{borderColor: `#${binToHex(sha256(hexToBin(commitment)).slice(0, 3))}`}} />
                </div>
                <span># { binToNumberUint16LE(hexToBin(commitment.slice(0,4))) }</span><br/>
                <span>🔒 { binToNumberInt32LE(hexToBin(commitment.slice(4))) / 1e8 } BCH</span>
              </div>
            )}
          </div>
        </>}

        {false && connectedAddress &&
        <>
          <hr className='my-5'/>
          <div>
            <div>Admin tools</div>
            <div>
              <button type="button" onClick={() => signMessage("test")} className="mt-5 inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out">Sign test message</button>
            </div>
          </div>
        </>}

        <>
          <hr className='my-5'/>
          <div>
            <div>Tools</div>
            <div>
              <button type="button" onClick={() => consolidate()}className={`inline-block px-6 py-2.5 bg-gray-200 text-gray-700 font-medium text-xs leading-tight uppercase rounded shadow-md hover:bg-gray-300 hover:shadow-lg  active:bg-gray-400 active:shadow-lg transition duration-150 ease-in-out`}>Consolidate UTXOs</button>
            </div>
          </div>
        </>
      </main>
    </>
  )
}), { ssr: false });

const numberToBinUintLE = (value) => {
  const baseUint8Array = 256;
  const result: any[] = [];
  let remaining = value;
  while (remaining >= baseUint8Array) {
    result.push(remaining % baseUint8Array);
    remaining = Math.floor(remaining / baseUint8Array);
  }
  if (remaining > 0) result.push(remaining);
  return Uint8Array.from(result);
};
const binToFixedLength = (bin, bytes) => {
  const fixedBytes = new Uint8Array(bytes);
  const maxValue = 255;
  bin.length > bytes ? fixedBytes.fill(maxValue) : fixedBytes.set(bin);
  return fixedBytes;
};
const swapEndianness = (validHex) => binToHex(hexToBin(validHex).reverse());


const safeboxCash = `
pragma cashscript ^0.8.0;

// Emerald DAO Safebox v2.0.0

// Withdrawal TX Form
//   - Locktime: must be greater than DAO's vaultReopenLocktime
//   - Inputs:
//     - 00: this (Safebox)
//     - 01: matching keycard NFT
//   - Outputs:
//     - 00: BCH destination, same address as keycard NFT's prevout
contract Safebox(
    int dustLimit,
    int vaultReopenLocktime,
    int maxSafeboxes
) {
    function OnlyOne() {
        // If valid Safebox UTXO
        if(
            tx.inputs[this.activeInputIndex].value >= dustLimit &&
            tx.inputs[this.activeInputIndex].tokenCategory.length == 32 &&
            tx.inputs[this.activeInputIndex].nftCommitment.length == 2 &&
            within(int(tx.inputs[this.activeInputIndex].nftCommitment),
                0, maxSafeboxes + 1) &&
            tx.inputs[this.activeInputIndex].tokenAmount == 0
        ) {
            // Timelock must expire before users will be allowed to
            // withdraw from their safeboxes.
            require(tx.time >= vaultReopenLocktime);

            // Ensure this contract has correct input index
            require(this.activeInputIndex == 0);

            // Require exactly 2 inputs:
            // - inputs[0] is this contract, the safebox
            // - inputs[1] is the matching keycard
            require(tx.inputs.length == 2);

            // Verify safebox category matches the keycard's category
            // Note: if DAO was correctly instanced, then Vault contract ensures
            // these will be immutable NFTs so we don't need to check NFT capability
            // here.
            require(
                tx.inputs[0].tokenCategory
                == tx.inputs[1].tokenCategory
            );

            // Verify safebox serial number == keycard serial number
            // Note: Vault contract ensures 1-to-1 mapping
            require(
                tx.inputs[0].nftCommitment
                == tx.inputs[1].nftCommitment.split(2)[0]
            );

            // Require exactly 1 output: the BCH withdrawal output
            require(tx.outputs.length == 1);

            // No need to check for BCH amount of it, keycard spender's signeture
            // covers it and the signer decides how much to leave out for fee.
            // SIGHASH_ONE can't pass this TX since output-1 can't exist, so safe to
            // use the keycard NFT in CoinJoin TXes.

            // Verify that output category == 0
            // This means that the pair of NFTs is implicitly burned together
            require(tx.outputs[0].tokenCategory == 0x);

            // Verify BCH is paid to same address that keycard NFT came from
            require(tx.outputs[0].lockingBytecode == tx.inputs[1].lockingBytecode);
        }
        // Else polluting UTXO,
        // allow BCH to be claimed by anyone.
    }
}
    `.trim();

      const vaultCash = `
pragma cashscript ^0.8.0;

// Emerald DAO Vault v2.0.1

// Transaction Forms
//      Clean
//          Inputs: this in any slot, any other input
//          Outputs: anything
//      Close
//          Inputs: 00-covenant
//          Outputs: 00-executorFee, [01-rewardsRemainderBeneficiary]
//      Add or Deposit
//          Inputs: 00-covenant, 01-funding
//          Outputs (Add): 00-covenant, [01-change]
//          Outputs (Deposit): 00-covenant, 01-keycard, 02-safebox, [03-change]

contract Vault(
    int feeAllowance,
    int dustLimit,
    int executorFee,
    int rewardsMinimumIncrement,
    int vaultCloseLocktime,
    int maxSafeboxes,
    int childSafeboxNominalValue,
    bytes childSafeboxLockingBytecode,
    bytes rewardsRemainderBeneficiary
) {
    // Only one function so no input data,
    // everything will be inferred from TX context.
    function OnlyOne() {
        // Note: If this contract is placed on anything but a proper Vault
        // covenant UTXO, we will allow spending by anyone in any TX context.

        // If this is pure BCH UTXO
        if (tx.inputs[this.activeInputIndex].tokenCategory == 0x) {
            // then clean-up polluting UTXO.
        }
        // Else check whether the UTXO is a valid Vault instance.
        else {
            // If invalid Vault instance
            if (
                // An instance is invalid if it is NOT valid
                !(
                    // What is a valid instance?

                    // Valid Vault MUST have more than dustLimit
                    tx.inputs[this.activeInputIndex].value >= dustLimit
                    // Valid Vault MUST have minting NFT capability
                    && tx.inputs[this.activeInputIndex].tokenCategory.split(32)[1]
                        == 0x02
                    // Valid Vault MUST encode exactly 2 bytes of commitment
                    && tx.inputs[this.activeInputIndex].nftCommitment.length == 2
                    // Valid Vault MUST have the commitment within valid range
                    && within(int(tx.inputs[this.activeInputIndex].nftCommitment),
                        0, maxSafeboxes+1)
                    // Valid Vault MUST NOT have a fungible token amount
                    && tx.inputs[this.activeInputIndex].tokenAmount == 0
                )
            ) {
                // then clean-up polluting UTXO.
            }
            // Else this is a valid Vault instance, and this branch must
            // must also ensure that it stays a valid instance when updated.
            // Allowed actions:
            // - close_max_reached (burns the covenant)
            // - close_timelock_reached (burns the covenant)
            // - deposit (extends the covenant and emits keycard & safebox NFTs)
            // - add_to_rewards_pool (extends the covenant)
            else {
                // Make sure this contract is being executed as input 0.
                require(this.activeInputIndex == 0);

                // If Vault reached maxSafeboxes then it MUST be closed,
                // but if it reached vaultCloseLocktime then it MAY
                // be closed since spender is free to adjust tx.locktime.
                if (
                    int(tx.inputs[0].nftCommitment) == maxSafeboxes
                    || tx.locktime >= vaultCloseLocktime
                ) {
                    // Close Vault

                    // Require exactly 1 input: this contract.
                    require(tx.inputs.length == 1);

                    // We will have at least 1 output in any of
                    // the below cases, check that it is pure BCH.
                    require(tx.outputs[0].tokenCategory == 0x);

                    // If remaining amount is too low then
                    // pay out everything as executor fee.
                    if (
                        tx.inputs[0].value
                        < dustLimit + feeAllowance + executorFee
                    ) {
                        require(tx.outputs.length == 1);
                    }
                    // Else there's a remainder, which MUST be
                    // paid out to rewardsRemainderBeneficiary
                    // in the 2nd output.
                    else {
                        // Require 2 inputs instead of 1
                        require(tx.outputs.length == 2);

                        // Everything but feeAllowance &
                        // executorFee (outputs[0].value)
                        // goes to 2nd output (outputs[1]).
                        require(
                            tx.outputs[1].value
                            >= tx.inputs[0].value - feeAllowance - executorFee
                        );

                        // Check that it is pure BCH.
                        require(tx.outputs[1].tokenCategory == 0x);

                        // Check that it goes to rewardsRemainderBeneficiary
                        require(
                            tx.outputs[1].lockingBytecode
                            == rewardsRemainderBeneficiary
                        );
                    }
                }
                // Else we're either doing a deposit or
                // adding to rewards pool
                else {
                    // Deposit or Add to rewards pool

                    // In either case the transaction
                    // must have exactly 2 inputs:
                    // - inputs[0] is this contract;
                    // - inputs[1] is the funding input.
                    require(tx.inputs.length == 2);

                    // Verify that the funding input is pure BCH.
                    require(tx.inputs[1].tokenCategory == 0x);

                    // Verify max. 4 outputs
                    require(tx.outputs.length <= 4);

                    // Minting NFT must be passed on
                    // to outputs[0] in any case.
                    require(
                        tx.inputs[0].tokenCategory
                        == tx.outputs[0].tokenCategory
                    );

                    // Vault covenant must be passed on
                    // to outputs[0] in any case.
                    require(
                        tx.inputs[0].lockingBytecode
                        == tx.outputs[0].lockingBytecode
                    );

                    // If the TX has 2 or 4 outputs then
                    // the last output MUST be a BCH change output.
                    if (tx.outputs.length % 2 == 0) {
                        // Allow any BCH value as change, it's on
                        // the user to choose how much to pay for
                        // fee and balance the TX correctly.

                        // Change output must be pure BCH
                        require(
                            tx.outputs[tx.outputs.length - 1].tokenCategory
                            == 0x
                        );

                        // Change output must have same locking script
                        // as funding input's prevout.
                        // This is to simplify TX building and prevent
                        // user errors.
                        require(
                            tx.outputs[tx.outputs.length - 1].lockingBytecode
                            == tx.inputs[1].lockingBytecode
                        );
                    }

                    // If TX is not trying to change the committment
                    // then we're adding to rewards pool.
                    if (
                        tx.outputs[0].nftCommitment
                        == tx.inputs[0].nftCommitment
                    ) {
                        // Add to rewards pool

                        // Max. 2 outputs, Vault + optional BCH change
                        require(tx.outputs.length <= 2);

                        // Output 00: Vault

                        // Require minimum increment to prevent maliciously
                        // respending the Vault with small increments.
                        require(
                            tx.outputs[0].value
                            >= tx.inputs[0].value + rewardsMinimumIncrement
                        );

                        // Note: above we already checked category & capability

                        // Note: the above If statement
                        // already checked the commitment

                        // Note: above we already checked locking bytecode

                        // Output 01: BCH change
                        // If there is a change output,
                        // we have already verified it above.
                    }
                    // Else it means we're doing a deposit.
                    else {
                        // Deposit

                        // Calculate leftToMint
                        int leftToMint
                            = maxSafeboxes - int(tx.inputs[0].nftCommitment);
                        // Calculate availableRewards
                        int availableRewards
                            = tx.inputs[0].value - dustLimit - executorFee;
                        // Calculate allottedReward
                        int allottedReward
                            = max(0, availableRewards) / leftToMint;

                        // Output 00: Vault

                        // Verify no more than allottedReward is taken
                        // from the Vault's reward pool.
                        require(
                            tx.outputs[0].value
                            >= tx.inputs[0].value - allottedReward
                        );

                        // Note: above we already checked category & capability

                        // Minting NFT commitment MUST be incremented by 1.
                        require(
                            tx.outputs[0].nftCommitment
                            == bytes2(int(tx.inputs[0].nftCommitment) + 1)
                        );

                        // Note: above we already checked locking bytecode

                        // Output 01: keycard NFT

                        // Enforce exactly the dust amount for consistency
                        require(tx.outputs[1].value == dustLimit);

                        // Verify categoryID & NFT immutable capability
                        require(
                            tx.outputs[1].tokenCategory
                            == tx.outputs[0].tokenCategory.split(32)[0]
                        );

                        // Verify NFT commitment encodes both the NFT#
                        // and value being placed in the safebox.
                        require(
                            tx.outputs[1].nftCommitment
                            == tx.outputs[0].nftCommitment
                                + bytes8(tx.outputs[2].value)
                        );

                        // Verify keycard is sent back to funding address
                        require(
                            tx.outputs[1].lockingBytecode
                            == tx.inputs[1].lockingBytecode
                        );

                        // Output 02: safebox NFT

                        // Whatever reward was pulled from the pool must
                        // be locked in the safebox together with the principal.
                        int claimedReward
                            = max(0, tx.inputs[0].value - tx.outputs[0].value);
                        require(
                            tx.outputs[2].value
                            >= childSafeboxNominalValue + claimedReward
                        );

                        // Verify categoryID & NFT immutable capability
                        require(
                            tx.outputs[2].tokenCategory
                            == tx.outputs[1].tokenCategory
                        );

                        // Verify NFT commitment encodes the NFT#.
                        require(
                            tx.outputs[2].nftCommitment
                            == tx.outputs[0].nftCommitment
                        );

                        // Verify safebox lock
                        require(
                            tx.outputs[2].lockingBytecode
                            == childSafeboxLockingBytecode
                        );

                        // Output 03: BCH change
                        // If there is a change output,
                        // we have already verified it above.
                    }
                }
            }
        }
    }
}
    `.trim();

    // DAO Instance
    let daoId = "97f1c6db63e4e41629cc5d437daa368441e57013159487500bacffed388ef9b6";

    // DAO Configuration
    let daoFeeAllowance = 1600;
    let daoDustLimit = 800;
    let daoExecutorFee = 1000000;
    let daoRewardsMinimumIncrement = 1000000;
    let daoVaultCloseLocktime = 1683963735;
    let vaultReopenLocktime = 1684000000;
    let daoMaxSafeboxes = 2000;
    let daoChildSafeboxNominalValue = 1000000;
    let daoRewardsRemainderBeneficiary = "0x76a914c525d7e7d1691122eb8810c108aee627a3e25b5388ac";

    if (isActivated) {
      daoId = "180f0db4465c2af5ef9363f46bacde732fa6ffb3bfe65844452078085b2e7c93";

      // DAO Configuration
      daoFeeAllowance = 1600;
      daoDustLimit = 800;
      daoExecutorFee = 10000000;
      daoRewardsMinimumIncrement = 10000000;
      daoVaultCloseLocktime = 1686830400;
      vaultReopenLocktime = 1715774400;
      daoMaxSafeboxes = 2000;
      daoChildSafeboxNominalValue = 10000000;
      daoRewardsRemainderBeneficiary = "0x76a91420695faa553fb9f32d26ae2fa02e04de96fbcd4888ac";
    }

   const safeboxContract = new Contract(
      safeboxCash,
      [daoDustLimit,
       vaultReopenLocktime,
       daoMaxSafeboxes
      ],
      isActivated ? Network.MAINNET : Network.TESTNET
    );

    const daoChildSafeboxLockingBytecode = "0x" + binToHex((cashAddressToLockingBytecode(safeboxContract.getDepositAddress()) as any).bytecode);

    const vaultContract = new Contract(
      vaultCash,
      [daoFeeAllowance,
       daoDustLimit,
       daoExecutorFee,
       daoRewardsMinimumIncrement,
       daoVaultCloseLocktime,
       daoMaxSafeboxes,
       daoChildSafeboxNominalValue,
       daoChildSafeboxLockingBytecode,
       daoRewardsRemainderBeneficiary
      ],
      isActivated ? Network.MAINNET : Network.TESTNET
    );

    // const mintCost = 250000;
    const maxAmount = daoMaxSafeboxes;
    const tokenValue = 1000;
    const minerFee = 800;
