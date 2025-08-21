import { Pset } from "liquidjs-lib";

const Spline = require("cubic-spline");

export interface Utxo {
  status: any;
  txid: string;
  value: number;
  vout: number;
}

let networkExplorers: { [key: string]: string } = {
  regtest: "http://localhost:3001",
  testnet: "https://blockstream.info/liquidtestnet/api",
  mainnet: "https://blockstream.info/liquid/api",
};

export default class EsploraClient {
  API_URL: string;

  constructor(networkName) {
    this.API_URL = networkExplorers[networkName];
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    let response = await fetch(`${this.API_URL}/address/${address}/utxo`);
    let utxos: Utxo[] = (await response.json()) as any;

    if (!utxos) {
      throw new Error("No utxos");
    }

    return utxos;
  }
  async getFeerate(feeTargets: number[]): Promise<{ [key: number]: number }> {
    let response = await fetch(`${this.API_URL}/fee-estimates`);
    let feeEstimates = await response.json();

    let interpolatedFeeRates: { [key: number]: number } = {};

    if (!feeEstimates || !Object.keys(feeEstimates).length) {
      feeTargets.map((t) => (interpolatedFeeRates[t] = 1));
      return interpolatedFeeRates;
    }

    let xs = Object.keys(feeEstimates);
    let ys = Object.values(feeEstimates);
    const spline = new Spline(xs, ys);

    feeTargets.map((t) => (interpolatedFeeRates[t] = spline.at(t)));
    return interpolatedFeeRates;
  }

  async broadcastTransactionHex(hex: string): Promise<string> {
    let response = await fetch(`${this.API_URL}/tx`, {
      method: "POST",
      body: hex
    });

    if (response.status != 200) {
      let error = await response.text();
      throw new Error(`Broadcast failed: ${error}`);
    }

    // Returns txid
    return response.text();
  }
}
