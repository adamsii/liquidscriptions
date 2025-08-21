import {
  bip341,
} from "liquidjs-lib";
import { varuint } from "liquidjs-lib/src/bufferutils";
import { LEAF_VERSION_TAPSCRIPT } from "liquidjs-lib/src/bip341";
let ecc = require("tiny-secp256k1");

const MAX_BYTE_SIZE = 520;
const ORD_PROTOCOL_ID = "6f7264";

const ERRORS = {
  INSCRIPTION_DATA_IS_EMPTY: "Inscription data is empty",
};

export const toXOnly = (publicKey: Buffer) =>
  publicKey.length === 32 ? publicKey : publicKey.subarray(1, 33);

export function generateInscriptionScriptFromFileHex(
  publicKey: Buffer,
  contentTypeHex: string,
  fileHex: string
) {
  if (!fileHex?.length) {
    throw new Error(ERRORS.INSCRIPTION_DATA_IS_EMPTY);
  }

  let lockingScript = `${toXOnly(publicKey).toString("hex")} OP_CHECKSIG`;

  /****Every string added must start with a space****/

  // Add protocol id
  lockingScript += ` OP_FALSE OP_IF ${ORD_PROTOCOL_ID}`;

  // Add content type
  // Can't push 01 with bitcoin-js's fromASM so CONTENT_TYPE_MARKER not used for now
  // It uses '11' which is a placeholder for '01'. It's replaced in createOutputAddress
  lockingScript += ` 11 ${contentTypeHex}`;

  // Add inscription data

  // 2 * MAX_BYTE_SIZE because 2 characters make up a byte in hex
  let regexChunker = new RegExp(`.{1,${2 * MAX_BYTE_SIZE}}`, "g");
  let chunks = fileHex.match(regexChunker);

  lockingScript += ` OP_0 ${chunks!.join(" ")}`;

  // Finish script with endif
  lockingScript += ` OP_ENDIF`;

  return lockingScript;
}

export function getOutputWitnessScriptData(
  script,
  internalPublicKey
): {
  parity: number;
  encodedScriptSize: Buffer;
} {
  let leaves = [
    {
      scriptHex: script.toString("hex"),
    },
  ];

  let leafHash = bip341.tapLeafHash(leaves[0]);
  let hashTree = bip341.toHashTree(leaves);
  let path = bip341.findScriptPath(hashTree, leafHash);

  const bip341Factory = bip341.BIP341Factory(ecc);
  let taprootStack = bip341Factory.taprootSignScriptStack(
    internalPublicKey,
    leaves[0],
    hashTree.hash,
    path
  );

  let parity = taprootStack[1][0] % LEAF_VERSION_TAPSCRIPT;
  let encodedScriptSize = varuint.encode(script.length);
  return {
    parity,
    encodedScriptSize,
  };
}

export function fileExtensionToHexMarker(fileExtension: string) {
  let x = {
    json: "application/json",
    pdf: "application/pdf",
    //...
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    //...
    txt: "text/plain;charset=utf-8",
  }[fileExtension];

  if (!x) {
    throw new Error(`Unsupported content type: ${x}`);
  }

  return asciiToHex(x);
}

export default function asciiToHex(s: string) {
  return s
    .split("")
    .map((c) => c.charCodeAt(0).toString(16))
    .join("");
}