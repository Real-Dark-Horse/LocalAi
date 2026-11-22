import React, { useEffect, useRef } from "react";
import lottie from "lottie-web/build/player/lottie_light";
import loadingData from "../../../icons/loading.json";

interface LoadingAnimationProps {
  size?: number;
  className?: string;
}

export const LoadingAnimation: React.FC<LoadingAnimationProps> = ({
  size = 18,
  className = "text-accent",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const anim = lottie.loadAnimation({
      container: el,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: loadingData,
    });
    return () => {
      anim.destroy();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: size, height: size }}
      className={`lottie-loading inline-flex shrink-0 items-center justify-center ${className}`}
      aria-label="Loading"
    />
  );
};
