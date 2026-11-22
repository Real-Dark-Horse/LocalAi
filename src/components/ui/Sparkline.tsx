import React from "react";

interface SparklineProps {
  values: number[];
  max?: number;
  width?: number;
  height?: number;
  color?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  max = 100,
  width = 86,
  height = 22,
  color = "#3B82F6",
}) => {
  const safeMax = max > 0 ? max : 100;
  const pts = values.length > 1 ? values : [0, values[0] ?? 0];
  const stepX = width / Math.max(1, pts.length - 1);

  const coords = pts.map((v, i) => {
    const clamped = Math.max(0, Math.min(safeMax, v));
    const x = i * stepX;
    const y = height - (clamped / safeMax) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = coords.join(" ");
  const area = `0,${height} ${polyline} ${width},${height}`;

  return (
    <svg width={width} height={height} className="overflow-visible shrink-0">
      <polygon points={area} fill={color} fillOpacity={0.14} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polyline}
      />
    </svg>
  );
};
