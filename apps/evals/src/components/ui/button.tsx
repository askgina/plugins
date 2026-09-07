import * as React from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-grayscale-12 bg-grayscale-12 text-grayscale-1 hover:border-grayscale-11 hover:bg-grayscale-11 dark:border-grayscale-7 dark:bg-grayscale-6 dark:text-grayscale-12 dark:hover:border-grayscale-8 dark:hover:bg-grayscale-7",
        inverse:
          "border border-grayscale-12 bg-grayscale-12 text-grayscale-1 hover:border-grayscale-11 hover:bg-grayscale-11",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-grayscale-4 bg-grayscale-1 font-medium text-grayscale-12 shadow-xs hover:border-grayscale-5 hover:bg-grayscale-3 dark:bg-grayscale-3 dark:hover:border-grayscale-6 dark:hover:bg-grayscale-5",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        "icon-hover":
          "bg-grayscale-3 text-grayscale-11 transition-colors duration-200 hover:bg-grayscale-5 hover:text-grayscale-12",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-control px-3",
        lg: "h-11 rounded-control px-8",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  focusableWhenDisabled?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, focusableWhenDisabled, ...props }, ref) => {
    const buttonClassName = cn(buttonVariants({ variant, size, className }));

    if (asChild) {
      return <Slot className={buttonClassName} ref={ref} {...props} />;
    }

    return (
      <BaseButton
        className={buttonClassName}
        focusableWhenDisabled={focusableWhenDisabled}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
