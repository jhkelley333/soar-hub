import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 transition outline-none",
          "focus:ring-2 focus:ring-zinc-900",
          "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500",
          className
        )}
        {...props}
      />
    );
  }
);
