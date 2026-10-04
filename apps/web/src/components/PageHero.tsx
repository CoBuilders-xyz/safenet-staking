interface PageHeroProps {
  title: string
  subtitle: string
  children?: React.ReactNode
}

export function PageHero({ title, subtitle, children }: PageHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card px-6 py-10 md:px-10 md:py-12">
      {/* Accent wash and dot grid, drawn from tokens so both follow the theme */}
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,var(--accent)_0%,transparent_55%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-70 bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-[length:16px_16px] [mask-image:linear-gradient(to_left,black,transparent_70%)]"
        aria-hidden="true"
      />
      <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />

      <div className="relative max-w-2xl">
        <h1 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
          {title}
        </h1>
        <p className="mt-3 text-base md:text-lg text-muted-foreground">
          {subtitle}
        </p>
        {children}
      </div>
    </section>
  )
}
