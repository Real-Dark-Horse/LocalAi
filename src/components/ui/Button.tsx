import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export const Button: React.FC<ButtonProps> = ({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...props
}) => {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-45 disabled:pointer-events-none select-none";
  const sizes = {
    sm: "h-7 px-2.5 text-xs",
    md: "h-8 px-3 text-[13px]",
  };
  const variants = {
    primary: "bg-accent text-white hover:bg-blue-500",
    secondary: "bg-hover text-ink border border-border hover:bg-selected",
    ghost: "text-muted hover:text-ink hover:bg-hover",
    danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
  };
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
