/**
 * Which deployment the smoke suite opens. It is deployment configuration, not a constant, so it
 * lives in the environment:
 *
 *   SMOKE_URL        the origin to check: the Vercel deployment, the ENS name through eth.limo, or
 *                    a release CID on a gateway path. Unset, the suite checks PRODUCTION_URL.
 *   PRODUCTION_URL   the production deployment, which is also the Safe App origin. A repository
 *                    variable in GitHub Actions.
 *
 * The manifest's CORS header is checked only on the Safe App origin, because Safe{Wallet} reads
 * the manifest from there. Other origins, such as eth.limo or a gateway, may send other headers.
 */
export interface SmokeTarget {
  /** With a trailing slash, so `./#/rewards` resolves under a deployment served from a path. */
  url: string
  /** True when the target is the Safe App origin, PRODUCTION_URL. */
  safeApp: boolean
}

function normalise(name: string, value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} is not a URL`)
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/"
  return url
}

export function smokeTarget(env: Readonly<Record<string, string | undefined>> = process.env): SmokeTarget {
  const production = env.PRODUCTION_URL?.trim()
  const explicit = env.SMOKE_URL?.trim()
  if (!explicit && !production) {
    throw new Error(
      "Neither SMOKE_URL nor PRODUCTION_URL is set. The smoke suite runs against a deployment and has no default. " +
        "Export SMOKE_URL, the URL of the deployment to check, or PRODUCTION_URL.",
    )
  }
  const url = explicit ? normalise("SMOKE_URL", explicit) : normalise("PRODUCTION_URL", production!)
  const safeApp = !explicit || (!!production && normalise("PRODUCTION_URL", production).href === url.href)
  return { url: url.href, safeApp }
}
