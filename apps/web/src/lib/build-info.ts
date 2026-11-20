/**
 * The identifier of this build, shown in the footer. Every value is baked in at build time
 * (vite.config.ts, scripts/release.ts), so every host that serves one build shows one string.
 */
export interface BuildInfo {
  /** The release version, when the release build set one, then the short commit SHA. */
  label: string
  /** The full commit SHA and the commit time. Absent in a dev server. */
  detail?: string
}

interface BuildEnv {
  VITE_RELEASE_VERSION?: string
  VITE_BUILD_COMMIT?: string
  VITE_BUILD_TIME?: string
}

export function buildInfo(env: BuildEnv = import.meta.env): BuildInfo {
  const version = env.VITE_RELEASE_VERSION
  const commit = env.VITE_BUILD_COMMIT
  const label = [version, commit?.slice(0, 7)].filter(Boolean).join(" · ") || "dev"
  const detail = [commit, env.VITE_BUILD_TIME].filter(Boolean).join(" · ")
  return detail ? { label, detail } : { label }
}
