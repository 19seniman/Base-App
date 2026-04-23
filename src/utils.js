import { ethers } from "ethers";

export function formatAmount(amount, decimals, displayDecimals = 6) {
  const formatted = ethers.formatUnits(amount, decimals);
  return parseFloat(formatted).toFixed(displayDecimals).replace(/\.?0+$/, "");
}

export function applySlippage(amountOut, slippagePercent) {
  const bps = BigInt(Math.round(slippagePercent * 100));
  return amountOut - (amountOut * bps) / 10000n;
}

export function getDeadline(minutes = 20) {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}

export function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function txLink(hash) {
  return `https://basescan.org/tx/${hash}`;
}
