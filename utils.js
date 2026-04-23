// ============================================================
//  UTILS.JS — Helper functions
// ============================================================
import { ethers } from "ethers";

/**
 * Format angka besar menjadi tampilan yang mudah dibaca
 * @param {bigint} amount - jumlah dalam wei/unit terkecil
 * @param {number} decimals - desimal token
 * @param {number} displayDecimals - tampilan desimal
 */
export function formatAmount(amount, decimals, displayDecimals = 6) {
  const formatted = ethers.formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  return num.toFixed(displayDecimals).replace(/\.?0+$/, "");
}

/**
 * Hitung amountOutMinimum berdasarkan slippage
 * @param {bigint} amountOut - estimasi output
 * @param {number} slippagePercent - slippage dalam persen (misal: 0.5)
 */
export function applySlippage(amountOut, slippagePercent) {
  const slippageBps = BigInt(Math.round(slippagePercent * 100)); // basis points
  const slippageAmount = (amountOut * slippageBps) / 10000n;
  return amountOut - slippageAmount;
}

/**
 * Hitung deadline transaksi
 * @param {number} minutes - menit dari sekarang
 */
export function getDeadline(minutes = 20) {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}

/**
 * Tunggu beberapa detik
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Singkat address wallet untuk tampilan
 */
export function shortenAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format hash transaksi sebagai link BaseScan
 */
export function txLink(hash) {
  return `https://basescan.org/tx/${hash}`;
}
