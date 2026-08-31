import { BRAND_GLYPHS } from "./brand-icons";

/**
 * The icon tile on an import card.
 *
 * Draws the real brand mark where simple-icons has one, and a monogram in the
 * brand's accent colour where it does not — Slack, Microsoft and Bear all
 * asked to be removed from that set, and inventing a lookalike path would be
 * both wrong and worse-looking than a clean letter.
 *
 * The mark is drawn in the accent colour at a low-opacity tint of the same
 * hue, so twenty different brands still read as one consistent grid rather
 * than a ransom note of competing logos.
 */
export function BrandIcon({
  icon,
  accent,
  name,
  size = 40,
}: {
  icon: string;
  accent: string;
  name: string;
  size?: number;
}) {
  const glyph = BRAND_GLYPHS[icon];
  const monogram = name
    .replace(/^(Any|Microsoft)\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden
      className="nodum-brand-tile"
      style={{
        width: size,
        height: size,
        // color-mix keeps the tint tied to the brand hue without needing a
        // second colour per source in the catalogue.
        background: `color-mix(in oklab, ${accent} 16%, transparent)`,
        color: accent,
      }}
    >
      {glyph ? (
        <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="currentColor">
          <path d={glyph.path} />
        </svg>
      ) : (
        <span className="nodum-brand-monogram">{monogram}</span>
      )}
    </span>
  );
}
