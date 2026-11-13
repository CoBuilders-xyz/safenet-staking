import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Markdown } from "@/components/Markdown"
import type { ContentPageName } from "@/config/legal"
import { currentLanguage } from "@/i18n"
import { SOURCE_LANGUAGE } from "@/i18n/languages"
import { parseMarkdown, type MarkdownDocument } from "@/lib/markdown"
import faq from "@/content/en/faq.md?raw"
import imprint from "@/content/en/imprint.md?raw"
import privacy from "@/content/en/privacy.md?raw"
import terms from "@/content/en/terms.md?raw"

// The text is written in English only. `src/content/README.md` says how to replace it.
const DOCUMENTS: Record<ContentPageName, MarkdownDocument> = {
  imprint: parseMarkdown(imprint),
  terms: parseMarkdown(terms),
  privacy: parseMarkdown(privacy),
  faq: parseMarkdown(faq),
}

const noticeClass = "rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"

/** One of the in-app documents: the imprint, the terms, the privacy policy or the FAQ. */
export function ContentPage({ name }: { name: ContentPageName }) {
  const { t } = useTranslation()
  const doc = DOCUMENTS[name]

  // A footer link is followed from the bottom of a page; the document starts at its top.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [name])

  return (
    <article className="mx-auto max-w-3xl space-y-6">
      {doc.meta.status === "placeholder" && (
        <p role="note" className={`${noticeClass} font-medium`}>
          {t("legal.placeholderNotice", "Placeholder. The final text is pending legal review.")}
        </p>
      )}
      {currentLanguage() !== SOURCE_LANGUAGE && (
        <p role="note" className={noticeClass}>
          {t("legal.englishOnly", "This text is only available in English.")}
        </p>
      )}
      <div lang={SOURCE_LANGUAGE}>
        <Markdown blocks={doc.blocks} />
      </div>
    </article>
  )
}
