#!/usr/bin/env ts-node

/**
 * ts-node-friendly CLI
 * Commands:
 *   - inscribe <file> [network] [privateKey]
 *   - extractfromtx <txhex> <out> [--show|-s]
 *   - test
 *
 * Integrations/changes:
 *   - Uses your lib's `inscribe(data, network, privKey, { fileExt })`
 *   - Maps "mainnet" -> liquidjs-lib's `networks.liquid`
 *   - `extractfromtx` uses --show/-s to print hex (no base64)
 *   - `extractInscriptionFromTransaction` returns { data, suggestedExtension }
 */

import { Command, InvalidArgumentError } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

// Pull the network objects from liquidjs-lib
import { networks as liquidNetworks } from "liquidjs-lib";
import type { Network } from "liquidjs-lib/src/networks";

// Use your lib's inscribe
import { inscribe as libInscribe } from "./lib";

// ---------- Utilities ----------

function isHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str);
}

function assertHexPrivateKey(pk: string): void {
  if (!isHex(pk)) {
    throw new InvalidArgumentError("Private key must be hex.");
  }
  if (pk.length !== 64) {
    throw new InvalidArgumentError(
      `Private key must be 32 bytes (64 hex chars). Got length ${pk.length}.`
    );
  }
}

function resolveNetwork(n?: string): Network {
  const v = (n ?? "mainnet").toLowerCase();
  switch (v) {
    case "mainnet":
      // liquidjs-lib's mainnet is named "liquid"
      return (liquidNetworks as any).liquid as Network;
    case "testnet":
      return (liquidNetworks as any).testnet as Network;
    case "regtest":
      return (liquidNetworks as any).regtest as Network;
    default:
      throw new InvalidArgumentError(
        `Invalid network "${n}". Expected one of: regtest, testnet, mainnet.`
      );
  }
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) {
      throw new Error(`Path exists but is not a file: ${filePath}`);
    }
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    throw err;
  }
}

async function readOrCreatePrivateKey(nextToFile: string): Promise<string> {
  // private-key.txt sits in the SAME DIRECTORY as the target file.
  const dir = path.dirname(path.resolve(nextToFile));
  const pkPath = path.join(dir, "private-key.txt");

  try {
    const raw = await fs.readFile(pkPath, "utf8");
    const pk = raw.trim();
    assertHexPrivateKey(pk);
    return pk;
  } catch (err: any) {
    if (!err || err.code !== "ENOENT") {
      if (err instanceof InvalidArgumentError) throw err;
      throw new Error(
        `Failed reading private-key.txt: ${String(err?.message ?? err)}`
      );
    }
    const pk = crypto.randomBytes(32).toString("hex");
    await fs.writeFile(pkPath, pk + "\n", { mode: 0o600 });
    return pk;
  }
}

// ---------- Local extractor (placeholder) ----------

// Minimal type sniffing to propose a file extension for the extracted data.
function sniffSuggestedExtension(buf: Buffer): string | undefined {
  if (buf.length >= 8) {
    if (
      buf
        .slice(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
      return ".png";
    if (buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
    if (buf.slice(0, 3).toString("ascii") === "GIF") return ".gif";
    if (
      buf.slice(0, 4).toString("ascii") === "RIFF" &&
      buf.slice(8, 12).toString("ascii") === "WEBP"
    )
      return ".webp";
    if (buf.slice(0, 5).toString("ascii") === "%PDF-") return ".pdf";
  }
  const start = buf
    .slice(0, Math.min(256, buf.length))
    .toString("utf8")
    .trimStart();
  if (start.startsWith("<svg")) return ".svg";
  return undefined;
}

/**
 * Rename from parseTransaction -> extractInscriptionFromTransaction
 * Placeholder: decodes txhex into bytes and suggests an extension.
 */
function extractInscriptionFromTransaction(txhex: string): {
  data: Buffer;
  suggestedExtension?: string;
} {
  if (!isHex(txhex)) throw new InvalidArgumentError("txhex must be hex.");
  if (txhex.length % 2 !== 0)
    throw new InvalidArgumentError(
      "txhex must have an even number of hex characters."
    );
  const data = Buffer.from(txhex, "hex");
  const suggestedExtension = sniffSuggestedExtension(data);
  // ChatGPT couldn't fill this out correctly so I'll program it manually
  throw new Error("Not implemented");
}

// ---------- CLI wiring (Commander) ----------

const program = new Command();

program
  .name("tscli")
  .description("A tiny TypeScript CLI (ts-node compatible)")
  .version("0.3.0")
  .usage("<command> [options]");

program.addHelpText(
  "after",
  `
Examples:
  # Inscribe a file on mainnet using private-key.txt (or auto-generate one)
  ts-node cli.ts inscribe ./artifact.png

  # Inscribe on testnet with an explicit private key
  ts-node cli.ts inscribe ./artifact.png testnet 0123...cdef

  # Extract an inscription, save to out (append suggested extension if needed), and also print hex
  ts-node cli.ts extractfromtx <txhex> ./out -s

  # Quick interactive test
  ts-node cli.ts test
`
);

// inscribe <file> [network] [privateKey]
program
  .command("inscribe")
  .description(
    "Read a file and pass its bytes to lib.inscribe(data, network, privateKey, { fileExt }).\n" +
      "If no private key arg is given, uses ./private-key.txt next to the file (creates if missing)."
  )
  .argument("<file>", "Path to file to inscribe (must exist).")
  .argument(
    "[network]",
    "regtest | testnet | mainnet (default: mainnet)",
    "mainnet"
  )
  .argument("[privateKey]", "32-byte hex private key (64 hex chars).")
  .action(async (fileArg: string, networkArg?: string, pkArg?: string) => {
    try {
      const filePath = path.resolve(fileArg);
      await ensureFileExists(filePath);

      const network = resolveNetwork(networkArg);

      let privateKey: string;
      if (typeof pkArg === "string" && pkArg.length > 0) {
        assertHexPrivateKey(pkArg);
        privateKey = pkArg;
      } else {
        privateKey = await readOrCreatePrivateKey(filePath);
      }

      const data = await fs.readFile(filePath);
      const ext =
        path.extname(filePath).replace(/^\./, "").toLowerCase() || "bin";

      // Let the lib handle its interactive flow; we pass the fileExt so your marker matches content.
      const result = await libInscribe(data, network, privateKey, {
        fileExt: ext,
      });

      // Be flexible with return shape: your current lib returns the broadcast response;
      // if you adopt the structured return later, we show a bit more info.
      if (result && typeof result === "object" && "txHex" in result) {
        const r: any = result;
        if (r.address) console.log(`Funding address: ${r.address}`);
        if (r.txHex) {
          await fs.writeFile("inscription-tx.hex", r.txHex + "\n", {
            mode: 0o600,
          });
          console.log(`Wrote transaction hex to inscription-tx.hex`);
        }
        console.log("Broadcast response:", r.broadcast ?? r);
      } else {
        console.log("Broadcast response:", result);
      }
    } catch (err: any) {
      console.error(`Error: ${String(err?.message ?? err)}`);
      process.exitCode = 1;
    }
  });

// extractfromtx <txhex> <out> [--show]
program
  .command("extractfromtx")
  .description(
    "Extract inscription bytes from a transaction hex and save to <out>.\n" +
      "If -s/--show is set, also print the data as hex to stdout."
  )
  .argument("<txhex>", "Transaction hex string to parse.")
  .argument(
    "<out>",
    "Output path (file or directory). If no extension is provided, a suggested one may be appended."
  )
  .option("-s, --show", "Print extracted bytes as hex to stdout.", false)
  .action(async (txhex: string, outPath: string, opts: { show?: boolean }) => {
    try {
      const { data, suggestedExtension } =
        extractInscriptionFromTransaction(txhex);

      if (opts.show) {
        console.log(data.toString("hex"));
      }

      // Resolve target path, supporting directory targets and extension inference
      let target = path.resolve(outPath);
      let isDir = false;

      try {
        const st = await fs.stat(target);
        isDir = st.isDirectory();
      } catch {
        // doesn't exist -> treat as a file path, possibly append extension
      }

      if (isDir) {
        const ext = suggestedExtension ?? ".bin";
        target = path.join(target, `inscription${ext}`);
      } else {
        // If no extension and suggested exists, append it.
        if (!path.extname(target)) {
          const ext = suggestedExtension ?? ".bin";
          target = target + ext;
        }
      }

      await fs.writeFile(target, data);
      console.log(`Saved extracted data to: ${target}`);
      if (suggestedExtension) {
        console.log(`(Suggested extension applied: ${suggestedExtension})`);
      }
    } catch (err: any) {
      console.error(`Error: ${String(err?.message ?? err)}`);
      process.exitCode = 1;
    }
  });

// test
program
  .command("test")
  .description("Prompt for text, then echo it back.")
  .action(async () => {
    try {
      const rl = readline.createInterface({ input, output });
      const answer = await rl.question("Type something and press Enter: ");
      console.log(`You typed: ${answer}`);
      await rl.close();
    } catch (err: any) {
      console.error(`Error: ${String(err?.message ?? err)}`);
      process.exitCode = 1;
    }
  });

// Parse argv
program.parseAsync(process.argv).catch((err) => {
  console.error(`Fatal: ${String(err?.message ?? err)}`);
  process.exit(1);
});
