// =============================================================================
// The Muscat Bay stripe mark, drawn as vector shapes so it stays sharp at any
// size. Geometry matches brand/generate_assets.py (source-pixel units, square
// 0.5–89.7). The default colours reverse the mark out of the purple top bar:
// Sage Teal bars and white stripes, as on the app icon.
// =============================================================================

interface BrandMarkProps {
  className?: string;
  bars?: string;
  stripes?: string;
}

const BARS = ['0.6,0.5 12.7,0.5 12.7,57.9 0.6,70', '29.2,0.5 41.4,0.5 41.4,29.2 29.2,41.4', '57.8,0.5 70,0.5 70,0.6 57.8,12.8'];
const STRIPES = ['0.7,89.7 16.4,89.7 89.7,16.4 89.7,0.7', '37.6,89.7 52.6,89.7 89.7,52.6 89.7,37.6', '74.7,89.7 89.7,89.7 89.7,74.7'];

export function BrandMark({ className, bars = '#A4C5BB', stripes = '#FFFFFF' }: BrandMarkProps) {
  return (
    <svg viewBox="0.5 0.5 89.2 89.2" className={className} aria-hidden="true" focusable="false">
      <g fill={bars}>{BARS.map((points) => <polygon key={points} points={points} />)}</g>
      <g fill={stripes}>{STRIPES.map((points) => <polygon key={points} points={points} />)}</g>
    </svg>
  );
}
