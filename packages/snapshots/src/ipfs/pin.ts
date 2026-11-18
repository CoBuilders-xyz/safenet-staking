/**
 * Pinning a CAR to Pinata, the one path the release and the snapshots share.
 *
 * The CAR is uploaded as a CAR, so Pinata stores the DAG packed here and keeps its root CID.
 * A different CID back from Pinata is a failure: the pinned DAG would not be the one built.
 *
 * PINATA_JWT and PINATA_GATEWAY are secrets. PINATA_GATEWAY is optional: the dedicated gateway is
 * only reported, and the public gateways decide. Neither reaches a log: every error message goes
 * through the redactor `pinataCredentials` returns, and output names the dedicated gateway
 * "the dedicated Pinata gateway".
 */
import { IPFS_GATEWAYS } from "@cobuilders/safenet-core"
import { PinataSDK } from "pinata"
import { gatewayHost, type Gateway } from "./gateways.js"

export const DEDICATED_GATEWAY_LABEL = "the dedicated Pinata gateway"

export interface PinataCredentials {
  readonly jwt: string
  /** The dedicated gateway's host, when PINATA_GATEWAY is set. */
  readonly gateway?: string
  /** An error message with the JWT and the gateway host taken out. */
  readonly redact: (err: unknown) => string
}

/**
 * PINATA_JWT and the optional PINATA_GATEWAY from the environment, or a sentence naming what is
 * missing or wrong. A caller fails on the sentence.
 */
export function pinataCredentials(env: NodeJS.ProcessEnv = process.env): PinataCredentials | string {
  const jwt = env.PINATA_JWT?.trim()
  const rawGateway = env.PINATA_GATEWAY?.trim()
  if (!jwt) return "PINATA_JWT is empty"
  const gateway = gatewayHost(rawGateway)
  if (rawGateway && !gateway) return "PINATA_GATEWAY holds no host. Set it to the dedicated gateway's host, or leave it empty"
  const redact = (err: unknown): string => {
    // undici's "fetch failed" carries the real reason, a DNS or TLS error, in `cause`.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined
    const message = err instanceof Error ? err.message : String(err)
    let text = (cause && cause !== message ? `${message} (${cause})` : message).replaceAll(jwt, "<jwt>")
    if (rawGateway && gateway) text = text.replaceAll(rawGateway, "<gateway>").replaceAll(gateway, "<gateway>")
    return text
  }
  return gateway ? { jwt, gateway, redact } : { jwt, redact }
}

/**
 * Each public gateway in IPFS_GATEWAYS from packages/core, which decide. Then the dedicated
 * gateway, when PINATA_GATEWAY is set, as an informational check.
 */
export function gatewaysToCheck(credentials: Pick<PinataCredentials, "gateway">): Gateway[] {
  return [
    ...IPFS_GATEWAYS.map((origin) => ({ label: origin, origin })),
    ...(credentials.gateway ? [{ label: DEDICATED_GATEWAY_LABEL, origin: `https://${credentials.gateway}`, informational: true }] : []),
  ]
}

/**
 * Upload `car` to Pinata as a CAR under `name`. Returns nothing: it throws, with the secrets
 * taken out, when Pinata refuses the upload or stores another CID than `cid`.
 */
export async function pinCar(
  credentials: PinataCredentials,
  car: Uint8Array,
  cid: string,
  options: { name: string; fileName: string },
): Promise<void> {
  const pinata = new PinataSDK({ pinataJwt: credentials.jwt })
  let upload: { cid: string }
  try {
    upload = await pinata.upload.public
      .file(new File([car as Uint8Array<ArrayBuffer>], options.fileName))
      .car()
      .name(options.name)
  } catch (err) {
    throw new Error(`Pinata did not take the upload: ${credentials.redact(err)}`)
  }
  if (upload.cid !== cid) throw new Error(`Pinata stored ${upload.cid}, not ${cid}. The pinned DAG is not the one built here`)
}
