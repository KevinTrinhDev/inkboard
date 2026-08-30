import qrcode from "qrcode-terminal";
import { activeSessionCount, generatePairingToken } from "./tokens.js";

/** A pairing link for one device. Each carries its own single-use nonce. */
export function pairingUrl(baseUrl: string, path = "/pair"): string {
  const token = generatePairingToken();
  return `${baseUrl}${path}?token=${encodeURIComponent(token)}`;
}

/**
 * Prints what each device needs to get paired, on startup.
 *
 * Two things used to be wrong here, and together they made the documented
 * two-device setup impossible to complete:
 *
 *  1. Exactly one pairing token was minted, once. /api/pair consumes a
 *     token's nonce single-use, so whichever device scanned first burned it
 *     and the second device could never pair at all. The only "fix" was to
 *     restart the server, which (2) then undid.
 *  2. Session credentials lived only in memory, so that restart invalidated
 *     the first device's credential. Pairing the laptop un-paired the iPad
 *     and vice versa, forever.
 *
 * (2) is fixed by initSessionStore(). This function fixes (1) by minting an
 * independent token per device, and stays quiet once both devices are
 * already paired, so a normal restart prints nothing to act on.
 */
export function printPairingInstructions(baseUrl: string, mirrorUrl: string): void {
  if (activeSessionCount() > 0) {
    console.log(
      `\ninkboard is up at ${baseUrl}` +
        `\n  ${activeSessionCount()} device(s) still paired from last time: nothing to scan.` +
        `\n  Laptop camera view: ${mirrorUrl}` +
        `\n  Need to add a device? Restart with:  pnpm go --pair\n`,
    );
    return;
  }

  console.log("\nScan this with the iPad's Camera app to pair the board:\n");
  qrcode.generate(pairingUrl(baseUrl), { small: true });
  console.log(
    `\n  iPad (manual):  ${pairingUrl(baseUrl)}` +
      `\n  Laptop camera:  ${pairingUrl(mirrorUrl, "")}` +
      `\n\nEach link carries its own token, so both devices can pair.` +
      `\nPairing is remembered, so next time you just run the server.\n`,
  );
}
