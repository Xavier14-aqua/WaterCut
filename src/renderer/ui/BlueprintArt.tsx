export function FrameGuide({
  className = '',
  cross = false,
}: {
  className?: string;
  cross?: boolean;
}) {
  return (
    <svg
      className={`frame-guide ${className}`}
      viewBox="0 0 240 140"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 34V14h25M201 14h25v20M14 106v20h25M201 126h25v-20" />
      {cross && (
        <path
          className="frame-diagonals"
          d="m14 14 212 112M14 126 226 14M120 14v14M120 112v14M14 70h15M211 70h15"
        />
      )}
    </svg>
  );
}

/** Exact geometry shared by the reference-inspired canvas and project covers. */
export function BlueprintArt({
  className = '',
  variant = 'orbit',
}: {
  className?: string;
  variant?: 'orbit' | 'target' | 'tunnel' | 'film';
}) {
  return (
    <svg
      className={`blueprint-art blueprint-art--${variant} ${className}`}
      viewBox="0 0 600 400"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {variant === 'target' ? (
        <g>
          <circle cx="300" cy="200" r="128" />
          <circle cx="300" cy="200" r="114" />
          <circle cx="300" cy="200" r="62" />
          <path d="M300 25v350M120 200h360M153 53l294 294M153 347 447 53" />
        </g>
      ) : variant === 'tunnel' ? (
        <g>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect
              key={i}
              x={26 + i * 37}
              y={28 + i * 25}
              width={548 - i * 74}
              height={344 - i * 50}
            />
          ))}
          <path d="m26 28 274 172L574 28M26 372l274-172 274 172M26 200h548M300 28v344M26 100l274 100L574 100M26 300l274-100 274 100" />
          <circle cx="300" cy="200" r="94" />
          <circle cx="300" cy="200" r="123" />
        </g>
      ) : (
        <g>
          {[74, 94, 106, 132, 148, 181, 194, 218, 234, 257, 275].map((r) => (
            <circle key={r} cx="300" cy="245" r={r} />
          ))}
          <ellipse
            cx="300"
            cy="245"
            rx="254"
            ry="70"
            transform="rotate(-32 300 245)"
          />
          <path d="M300 10v62M300 337v55M20 245h42M536 245h44M292 245h16M300 237v16" />
          <circle cx="439" cy="132" r="8" />
          <circle cx="439" cy="132" r="15" />
          <path d="m445 126 59-59M494 67h20M504 57v20" />
          {variant === 'film' && (
            <g transform="translate(470 12) rotate(10)">
              <rect width="112" height="375" />
              <path d="M12 0v375M100 0v375" />
              {[10, 131, 252].map((y) => (
                <rect key={y} x="24" y={y} width="64" height="102" rx="2" />
              ))}
              {Array.from({ length: 18 }, (_, i) => (
                <g key={i}>
                  <rect x="3" y={i * 21} width="6" height="12" />
                  <rect x="103" y={i * 21} width="6" height="12" />
                </g>
              ))}
            </g>
          )}
        </g>
      )}
      <path
        className="blueprint-corner"
        d="M16 48V16h32M552 16h32v32M16 352v32h32M552 384h32v-32"
      />
    </svg>
  );
}
