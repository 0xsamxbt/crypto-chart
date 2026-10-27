import { useState } from 'react';

// Stable colour per coin for the letter fallback
function hueOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

/**
 * Round coin logo. Falls back to a coloured letter badge when the coin has no image
 * (small coins outside the top 500) or the image fails to load.
 */
export default function CoinIcon({ base, image, size = 24 }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = image && failedSrc !== image;

  if (showImage) {
    return (
      <img
        className="coin-icon"
        src={image}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(image)}
      />
    );
  }

  const hue = hueOf(base);
  return (
    <span
      className="coin-icon ph"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `hsl(${hue} 45% 28%)`,
        color: `hsl(${hue} 85% 82%)`,
      }}
    >
      {base.slice(0, base.length > 3 ? 2 : 1)}
    </span>
  );
}
