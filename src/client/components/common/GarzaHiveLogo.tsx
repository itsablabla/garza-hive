import { cn } from '@/client/lib/utils'
import {
  GARZAHIVE_BRAND_COLORS,
  GARZAHIVE_ICON_ACCENT_BAND,
  GARZAHIVE_ICON_BANDS,
  GARZAHIVE_ICON_HEIGHT,
  GARZAHIVE_ICON_WIDTH,
  GARZAHIVE_ICON_WINGS,
  GARZAHIVE_ICON_WING_STROKE,
  GARZAHIVE_WORDMARK,
} from '@/client/components/common/garzahive-logo-paths'

export type GarzaHiveLogoVariant = 'primary' | 'white' | 'black' | 'mono'

export interface GarzaHiveLogoProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'title'> {
  /** Mark height in px (the mark is ~2.06x wider than tall). Default 32. */
  size?: number
  /**
   * How the mark is painted (see brand/README.md):
   * - `primary` (default): charcoal bands + amber wings and active cell in
   *   light mode; the bands flip to white in dark mode (reversed colourway).
   * - `white` / `black`: single-colour mark (mono lockups) for print/OG.
   * - `mono`: flat `currentColor`, so it inherits the surrounding text colour.
   */
  variant?: GarzaHiveLogoVariant
  /** Render the GARZAHIVE wordmark (Outfit SemiBold, outlined) next to the mark. */
  withWordmark?: boolean
  /** Extra classes for the wordmark SVG (e.g. responsive visibility). */
  wordmarkClassName?: string
  /** Accessible label. Pass `null` to mark the whole lockup decorative. */
  title?: string | null
}

const { amber, charcoal, white } = GARZAHIVE_BRAND_COLORS

// Horizontal lockup proportions from the brand spec (icon height = 216):
// wordmark cap height 71.7, gap 58.
const WORDMARK_CAP_RATIO = 71.7 / GARZAHIVE_ICON_HEIGHT
const GAP_RATIO = 58 / GARZAHIVE_ICON_HEIGHT
const WORDMARK_ASPECT = GARZAHIVE_WORDMARK.width / GARZAHIVE_WORDMARK.capHeight

/**
 * GarzaHive logomark — a bee reduced to hive geometry: one hexagon abdomen
 * sliced into four bands (the amber band is the active cell) and two flat-top
 * hexagon wings drawn in outline.
 *
 * One reusable, theme-aware lockup used everywhere the brand appears (app nav,
 * auth pages, error states). The default `primary` variant follows the brand
 * spec: charcoal + amber on light surfaces, white + amber on dark. Amber is
 * the only accent — the mark never follows the palette gradient.
 */
export function GarzaHiveLogo({
  size = 32,
  variant = 'primary',
  withWordmark = false,
  wordmarkClassName,
  title = 'GarzaHive',
  className,
  ...rest
}: GarzaHiveLogoProps) {
  const decorative = title == null

  // `primary` flips its band/wordmark colour with the app theme via classes;
  // the fixed variants paint everything one colour.
  const fixedFill =
    variant === 'white' ? white : variant === 'black' ? charcoal : 'currentColor'
  const isPrimary = variant === 'primary'
  const accent = isPrimary ? amber : fixedFill
  const bodyClass = isPrimary ? 'fill-[#1C1B19] dark:fill-white' : undefined
  const wordmarkFillClass = isPrimary ? 'fill-[#1C1B19] dark:fill-white' : undefined

  const markWidth = (size * GARZAHIVE_ICON_WIDTH) / GARZAHIVE_ICON_HEIGHT
  const wordmarkHeight = size * WORDMARK_CAP_RATIO

  return (
    <span
      className={cn('inline-flex shrink-0 items-center', className)}
      style={withWordmark ? { gap: size * GAP_RATIO } : undefined}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
      {...rest}
    >
      <svg
        width={markWidth}
        height={size}
        viewBox={`0 0 ${GARZAHIVE_ICON_WIDTH} ${GARZAHIVE_ICON_HEIGHT}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="block shrink-0"
        aria-hidden
      >
        <g transform={`translate(${GARZAHIVE_ICON_WIDTH / 2},${GARZAHIVE_ICON_HEIGHT / 2})`}>
          {GARZAHIVE_ICON_WINGS.map((d, i) => (
            <path
              key={`wing-${i}`}
              d={d}
              fill="none"
              stroke={accent}
              strokeWidth={GARZAHIVE_ICON_WING_STROKE}
              strokeLinejoin="round"
            />
          ))}
          {GARZAHIVE_ICON_BANDS.map((d, i) =>
            i === GARZAHIVE_ICON_ACCENT_BAND ? (
              <path key={`band-${i}`} d={d} fill={accent} />
            ) : (
              <path key={`band-${i}`} d={d} className={bodyClass} fill={isPrimary ? undefined : fixedFill} />
            ),
          )}
        </g>
      </svg>

      {withWordmark && (
        <svg
          width={wordmarkHeight * WORDMARK_ASPECT}
          height={wordmarkHeight}
          viewBox={`0 0 ${GARZAHIVE_WORDMARK.width} ${GARZAHIVE_WORDMARK.capHeight}`}
          xmlns="http://www.w3.org/2000/svg"
          className={cn('block shrink-0', wordmarkClassName)}
          aria-hidden
        >
          <g transform={`translate(0,${GARZAHIVE_WORDMARK.capHeight})`}>
            {GARZAHIVE_WORDMARK.glyphs.map((g, i) => (
              <path
                key={i}
                d={g.d}
                transform={`translate(${g.x},0) scale(1,-1)`}
                className={wordmarkFillClass}
                fill={isPrimary ? undefined : fixedFill}
              />
            ))}
          </g>
        </svg>
      )}
    </span>
  )
}

export default GarzaHiveLogo
