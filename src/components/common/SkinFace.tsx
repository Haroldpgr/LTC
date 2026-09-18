interface SkinFaceProps {
  src: string;
  alt?: string;
  size?: number;
  roundedClass?: string;
}

// Muestra solo la cara (8,8,8,8) de una skin 64x64/64x32 con su capa de
// sombrero encima, como los avatares de Minecraft.
export function SkinFace({ src, alt = '', size = 36, roundedClass = 'rounded-lg' }: SkinFaceProps) {
  const big = size * 8;
  const imgStyle: React.CSSProperties = {
    width: big,
    height: big,
    maxWidth: 'none',
    imageRendering: 'pixelated',
    userSelect: 'none',
    pointerEvents: 'none',
  };
  return (
    <div
      className={`${roundedClass} overflow-hidden shrink-0 bg-dark-800`}
      style={{ width: size, height: size }}
    >
      <div className="relative" style={{ width: big, height: big, marginLeft: -size, marginTop: -size }}>
        <img src={src} alt={alt} draggable={false} className="absolute inset-0" style={imgStyle} />
        {/* Capa sombrero (40,8,8,8) */}
        <div className="absolute overflow-hidden" style={{ width: size, height: size, left: size * 4, top: 0 }}>
          <img
            src={src}
            alt=""
            draggable={false}
            className="absolute"
            style={{ ...imgStyle, marginLeft: -size * 5, marginTop: 0 }}
          />
        </div>
      </div>
    </div>
  );
}
