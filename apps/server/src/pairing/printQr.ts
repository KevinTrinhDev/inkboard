import qrcode from "qrcode-terminal";
import { generatePairingToken } from "./tokens.js";

/**
 * Prints a fresh pairing token as a terminal QR code on server startup.
 * Scan it with the iPad's Camera app: docs/SECURITY.md "Device pairing".
 */
export function printPairingQr(baseUrl: string) {
  const token = generatePairingToken();
  const pairUrl = `${baseUrl}/pair?token=${encodeURIComponent(token)}`;

  console.log("\nScan this with the iPad's Camera app to pair:\n");
  qrcode.generate(pairUrl, { small: true });
  console.log(`\n(or open manually: ${pairUrl})\n`);
}
