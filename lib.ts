import ECPairFactory from "ecpair";
let ecc = require("tiny-secp256k1");
import {
  confidential,
  address,
  witnessStackToScriptWitness,
  script,
  bip341,
  Pset,
  PsetGlobal,
  Transaction,
  PsetInput,
  PsetOutput,
  Finalizer,
  Extractor,
} from "liquidjs-lib";
import {
  fileExtensionToHexMarker,
  generateInscriptionScriptFromFileHex,
} from "./helpers";
import { CONTENT_TYPE_MARKER, TRANSACTION_FEE_IN_SATOSHIS } from "./constants";
import { Network } from "liquidjs-lib/src/networks";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import * as fs from "fs/promises";
import EsploraClient from "./clients/esplora-client";

let ECPair = ECPairFactory(ecc);

// helper: parse "1.23456789" BTC -> sats (number)
function btcToSats(btcStr: string): number {
  const s = btcStr.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(s))
    throw new Error("Amount must be a number with up to 8 decimals.");
  const [ints, frac = ""] = s.split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  // fits safely in JS number; 21e6 BTC = 2.1e15 sats < 2^53
  return Number(ints) * 1e8 + Number(fracPadded);
}

type InscribeOptions = {
  interactive?: boolean; // default true
  fileExt?: string; // e.g. "png", "jpg", ...
  txid?: string;
  vout?: number;
  amountBtc?: string; // for non-interactive mode
  changeAddress?: string;
};

export async function inscribe(
  _data: Buffer,
  _network: Network,
  _privateKeyHex: string,
  opts: InscribeOptions = {}
) {
  const interactive = opts.interactive !== false;

  // --- derive inscription type (DON'T hardcode "jpg") ---
  const ext = (opts.fileExt ?? "bin").replace(/^\./, "").toLowerCase();

  // keys & leaf
  const internalKey = ECPair.fromPrivateKey(Buffer.from(_privateKeyHex, "hex"));
  const markerHex = fileExtensionToHexMarker(ext); // use caller's ext
  const inscriptionHex = _data.toString("hex");
  const inscriptionAsm = await generateInscriptionScriptFromFileHex(
    internalKey.publicKey,
    markerHex,
    inscriptionHex
  );
  const leafScript = script.fromASM(inscriptionAsm);
  leafScript[41] = parseInt(CONTENT_TYPE_MARKER);

  // taproot tree & address
  const leaves = [{ scriptHex: leafScript.toString("hex") }];
  const hashTree = bip341.toHashTree(leaves);
  const bip341Factory = bip341.BIP341Factory(ecc);
  const witnessProgram = bip341Factory.taprootOutputScript(
    internalKey.publicKey,
    hashTree
  );
  const p2trAddress = address.fromOutputScript(witnessProgram, _network);

  // collect funding UTXO
  let rl: readline.Interface | undefined;
  let txid: string, outputIndex: number, amountSats: number;
  let changeAddress: string;

  try {
    if (interactive) {
      rl = readline.createInterface({ input, output });
      console.log("\nSend funds to this (UNCONFIDENTIAL) address:");
      console.log(p2trAddress);
      console.log(
        "(Address depends on file data; different file => different address.)\n"
      );
      await rl.question(
        "Press Enter after the funding tx is confirmed (or when you have txid)..."
      );
      txid = (await rl.question("Funding txid (hex, 64 chars): ")).trim();
      outputIndex = Number((await rl.question("Output index (vout): ")).trim());
      const amountBtcStr = (await rl.question("Amount sent (BTC): ")).trim();
      amountSats = btcToSats(amountBtcStr);
      changeAddress = (
        await rl.question("Please enter a change address: ")
      ).trim();
    } else {
      if (
        !opts.txid ||
        typeof opts.vout !== "number" ||
        !opts.amountBtc ||
        !opts.changeAddress
      ) {
        throw new Error(
          "Non-interactive mode requires { txid, vout, amountBtc }."
        );
      }
      txid = opts.txid.trim();
      outputIndex = opts.vout;
      amountSats = btcToSats(opts.amountBtc);
      changeAddress = opts.changeAddress;
    }
  } finally {
    if (rl) rl.close();
  }

  if (!/^[0-9a-fA-F]{64}$/.test(txid))
    throw new Error("Invalid txid hex length.");
  if (!Number.isInteger(outputIndex) || outputIndex < 0)
    throw new Error("Invalid vout.");

  // build PSET
  const TRANSACTION_VERSION = 2;
  const feeSats = TRANSACTION_FEE_IN_SATOSHIS;
  if (amountSats <= feeSats) throw new Error("Amount must exceed fee.");

  const txInput = new PsetInput(
    Buffer.from(txid, "hex").reverse(),
    outputIndex,
    Transaction.DEFAULT_SEQUENCE
  );
  txInput.sighashType = Transaction.SIGHASH_DEFAULT;
  txInput.witnessUtxo = {
    asset: Buffer.concat([
      Buffer.from("01", "hex"),
      Buffer.from(_network.assetHash, "hex").reverse(),
    ]),
    script: witnessProgram,
    value: confidential.satoshiToConfidentialValue(amountSats),
    nonce: Buffer.from("00", "hex"),
  };

  const changeSats = amountSats - feeSats;
  const outputs = [
    new PsetOutput(
      changeSats,
      Buffer.from(_network.assetHash, "hex").reverse(),
      address.toOutputScript(changeAddress)
    ),
    new PsetOutput(
      feeSats,
      Buffer.from(_network.assetHash, "hex").reverse(),
      Buffer.alloc(0) // fee output
    ),
  ];

  const pset = new Pset(
    new PsetGlobal(TRANSACTION_VERSION, 1, outputs.length),
    [txInput],
    outputs
  );

  // taproot signing (script path)
  const leafHash = bip341.tapLeafHash(leaves[0]);
  const path = bip341.findScriptPath(hashTree, leafHash);
  const stack = bip341Factory.taprootSignScriptStack(
    internalKey.publicKey,
    leaves[0],
    hashTree.hash,
    path
  );

  const preimage = pset.getInputPreimage(
    0,
    Transaction.SIGHASH_DEFAULT,
    _network.genesisBlockHash,
    leafHash
  );
  pset.inputs[0].finalScriptWitness = witnessStackToScriptWitness([
    internalKey.signSchnorr(preimage),
    ...stack,
  ]);

  const finalizer = new Finalizer(pset);
  finalizer.finalizeInput(0);
  const tx = Extractor.extract(pset);
  const hex = tx.toHex();

  await fs.writeFile("inscription-tx.hex", hex + "\n", { mode: 0o600 });

  const esploraClient = new EsploraClient(_network.name);
  const broadcastResp = await esploraClient.broadcastTransactionHex(hex);

  return { address: p2trAddress, txHex: hex, broadcast: broadcastResp };
}
