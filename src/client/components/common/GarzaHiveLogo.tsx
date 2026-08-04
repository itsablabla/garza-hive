import { useId } from 'react'
import { cn } from '@/client/lib/utils'
import {
  GARZAHIVE_LOGO_GRADIENT_LINE,
  GARZAHIVE_LOGO_PATHS,
  GARZAHIVE_LOGO_VIEWBOX,
} from '@/client/components/common/garzahive-logo-paths'

export type GarzaHiveLogoVariant = 'gradient' | 'white' | 'black' | 'mono'

export interface GarzaHiveLogoProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'title'> {
  /** Mark height in px (the mark is square). Default 32. */
  size?: number
  /**
   * How the mark is painted:
   * - `gradient` (default): the active theme's aurora gradient. In the app the
   *   stops come from `--color-gradient-start/mid/end` (redefined per palette),
   *   so the mark follows the selected palette; elsewhere it falls back to the
   *   brand aurora. Matches the marketing site.
   * - `white` / `black`: flat single colour, no gradient (footers, print, OG).
   * - `mono`: flat `currentColor`, so it inherits the surrounding text colour.
   */
  variant?: GarzaHiveLogoVariant
  /** Render the "GarzaHive" wordmark next to the mark (Plus Jakarta Sans 800). */
  withWordmark?: boolean
  /** Extra classes for the wordmark text (e.g. to override its colour). */
  wordmarkClassName?: string
  /** Accessible label. Pass `null` to mark the whole lockup decorative. */
  title?: string | null
}

const MARK_FILL: Record<Exclude<GarzaHiveLogoVariant, 'gradient'>, string> = {
  white: '#ffffff',
  black: '#000000',
  mono: 'currentColor',
}

/**
 * GarzaHive logomark — a bee nested in a honeycomb cluster.
 *
 * One reusable, theme-aware lockup used everywhere the brand appears (app nav,
 * footers, marketing, OG). The mark is a set of flat shapes filled with a single
 * paint, so it recolours cleanly: a live theme gradient, or flat white/black for
 * single-colour contexts. Optionally pairs with the "GarzaHive" wordmark.
 */
export function GarzaHiveLogo({
  size = 32,
  variant = 'gradient',
  withWordmark = false,
  wordmarkClassName,
  title = 'GarzaHive',
  className,
  ...rest
}: GarzaHiveLogoProps) {
  const uid = useId()
  const gradId = `garzahive-logo-grad-${uid}`
  const decorative = title == null

  const markFill = variant === 'gradient' ? `url(#${gradId})` : MARK_FILL[variant]

  // The wordmark scales with the mark; gap is proportional too.
  const wordmarkStyle = { fontSize: size * 0.66, lineHeight: 1 }

  return (
    <span
      className={cn('inline-flex shrink-0 items-center', withWordmark && 'gap-2.5', className)}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
      {...rest}
    >
      <svg
        width={size}
        height={size}
        viewBox={GARZAHIVE_LOGO_VIEWBOX}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block shrink-0"
        aria-hidden
      >
        {variant === 'gradient' && (
          <defs>
            <linearGradient
              id={gradId}
              gradientUnits="userSpaceOnUse"
              x1={GARZAHIVE_LOGO_GRADIENT_LINE.x1}
              y1={GARZAHIVE_LOGO_GRADIENT_LINE.y1}
              x2={GARZAHIVE_LOGO_GRADIENT_LINE.x2}
              y2={GARZAHIVE_LOGO_GRADIENT_LINE.y2}
            >
              <stop stopColor="var(--color-gradient-start, #AE5AF9)" />
              <stop offset="0.52" stopColor="var(--color-gradient-mid, #FB5FCA)" />
              <stop offset="1" stopColor="var(--color-gradient-end, #FFB470)" />
            </linearGradient>
          </defs>
        )}
        <g fill={markFill}>
          {GARZAHIVE_LOGO_PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>

      {withWordmark && (
        <span
          className={cn('font-extrabold', wordmarkClassName)}
          style={wordmarkStyle}
        >
          GarzaHive
        </span>
      )}
    </span>
  )
}

export default GarzaHiveLogo
