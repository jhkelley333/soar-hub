import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "block w-full rounded-md border-0 bg-surface px-3 py-2 text-sm text-ink ring-1 ring-inset ring-border placeholder:text-ink-subtle transition outline-none",
          "focus:ring-2 focus:ring-accent",
          "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted",
          className
        )}
        {...props}
      />
    );
  }
);
