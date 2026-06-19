import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-surface-sunk disabled:text-ink-subtle",
  secondary:
    "bg-surface text-heading ring-1 ring-inset ring-border hover:bg-surface-muted disabled:text-ink-subtle",
  ghost:
    "text-ink-muted hover:bg-surface-muted disabled:text-ink-subtle",
  danger:
    "bg-cherry text-white hover:bg-cherry-hover disabled:bg-red-300",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-tight transition outline-none focus-visible:ring-2 focus-visible:ring-frost focus-visible:ring-offset-2 disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...props}
    />
  );
});
