cat > src/utils.js << 'EOF'
import { ethers } from "ethers";

export function formatAmount(amount, decimals, displayDecimals = 6) {
  const formatted = ethers.formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  return num.toFixed(displayDecimals).replace(/\.?0+$/, "");
}

export function applySlippage(amountOut, slippagePercent) {
  const slippageBps = BigInt(Math.round(slippagePercent * 100));
  const slippageAmount = (amountOut * slippageBps) / 10000n;
  return amountOut - slippageAmount;
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
EOF
