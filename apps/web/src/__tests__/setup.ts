import "@testing-library/jest-dom/vitest"
import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { i18n, initI18n } from "@/i18n"
import { LANGUAGE_STORAGE_KEY } from "@/i18n/languages"

// Every test starts in English, the catalogue in the bundle. jsdom's navigator says en-US, so
// detection picks English; a test that switches language is put back here.
await initI18n()
afterEach(async () => {
  localStorage.removeItem(LANGUAGE_STORAGE_KEY)
  if (i18n.language !== "en") await i18n.changeLanguage("en")
})

// Auto-cleanup rendered components after each test.
// Required because globals:false means @testing-library can't find afterEach automatically.
afterEach(() => {
  cleanup()
})

// Stub lucide-react icons globally — they use dynamic ESM imports that jsdom can't resolve.
// Each mock returns a simple span so components render without errors.
vi.mock("lucide-react/dist/esm/icons/loader-2", () => ({
  default: () => null,
}))
vi.mock("lucide-react/dist/esm/icons/info", () => ({
  default: () => null,
}))
vi.mock("lucide-react/dist/esm/icons/fuel", () => ({
  default: () => null,
}))
vi.mock("lucide-react/dist/esm/icons/check-circle", () => ({
  default: () => null,
}))
