# Ordinal Inscription CLI

A TypeScript CLI tool for working with Ordinal-style inscriptions on Liquid/Bitcoin using `ts-node`.  
Commands are implemented in `cli.ts` and delegate to library functions in `lib.ts`.

---

## Prerequisites

- Node.js ≥ 18
- [ts-node](https://typestrong.org/ts-node/) installed globally or as a dev dependency:

```bash
npm install --save-dev ts-node typescript
```

---

## Running the CLI

All commands are invoked through `ts-node cli.ts`:

```bash
npx ts-node cli.ts <command> [options]
```

For help:

```bash
npx ts-node cli.ts --help
npx ts-node cli.ts <command> --help
```

---

## Commands

### `inscribe <file> [network] [privateKey]`

Prepare and broadcast an inscription transaction.

- `<file>`: Path to the file you want to inscribe.
- `[network]`: One of `mainnet` (default), `testnet`, or `regtest`.
- `[privateKey]`: Optional hex-encoded 32-byte key.  
  - If omitted, the tool looks for `private-key.txt` in the same directory as `<file>`.
  - If that file doesn’t exist, a new key will be generated and saved there.

Interactive flow (in the library):
- Displays a Taproot address to fund.
- Waits for confirmation and asks for the funding `txid`, `vout` (output index), and amount (in BTC).
- If you added the optional **change address** feature: it will also ask whether you want to send change back to the generated Taproot address or to a custom address you provide.

Output:
- Writes `inscription-tx.hex` containing the raw transaction.
- Broadcasts it through Esplora.

Example:

```bash
npx ts-node cli.ts inscribe ./artifact.png testnet
```

---

### `extractfromtx <txhex> <out> [--show]`

Extracts inscription data from a transaction hex string.

- `<txhex>`: Raw transaction hex.
- `<out>`: Output path.  
  - If `<out>` is a directory, a file named `inscription.<ext>` is written.
  - If `<out>` is a filename without an extension, a suggested extension may be added.
- `--show` / `-s`: Also print the extracted data as **hex** to stdout.

⚠️ Currently, the internal parser is a stub (`Not implemented`). Once implemented, it will scan the transaction inputs for an Ordinals inscription and return the embedded file contents.

Example:

```bash
npx ts-node cli.ts extractfromtx <txhex> ./outdir -s
```

---

### `test`

Simple interactive demo. Prompts for input and echoes it back.

```bash
npx ts-node cli.ts test
```

---

## Quickstart: Inscribing a Test File

The repo includes a sample file `1-pixel.png` you can inscribe.

1. Run the command:

   ```bash
   npx ts-node cli.ts inscribe ./1-pixel.png regtest
   ```

2. The program will:
   - Show you a Taproot address to fund.
   - Ask you to enter the funding transaction ID (`txid`), output index, and amount (in BTC).
   - Optionally, ask for a change address if you’ve enabled that feature.

3. Once you’ve entered the details:
   - The inscription transaction will be created.
   - A raw hex file `inscription-tx.hex` will be written.
   - The transaction will be broadcast via Esplora.

---

## Development Notes

- The `lib.ts` file contains the core `inscribe` implementation. It uses `liquidjs-lib` for transaction construction, Taproot signing, and broadcasting via Esplora.
- Private keys are stored in plaintext (`private-key.txt`) in the same directory as the target file. File permissions are restricted (0600).
- `extractInscriptionFromTransaction` is scaffolded but currently throws `"Not implemented"`. Future work: parse tapscripts, locate the `"ord"` marker, and reconstruct inscription payloads.

---

## Roadmap

- [ ] Implement full `extractInscriptionFromTransaction` parsing logic.
- [ ] Add option to output inscription data directly to stdout.
- [ ] Support confidential addresses for funding.
- [ ] Better error reporting for insufficient fees and funding mismatches.
