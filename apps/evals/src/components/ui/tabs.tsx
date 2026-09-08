import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";

import { cn } from "../../lib/utils";

function mergeClassName<State>(
  baseClassName: string,
  className: string | ((state: State) => string | undefined) | undefined,
) {
  if (typeof className === "function") {
    return (state: State) => cn(baseClassName, className(state));
  }

  return cn(baseClassName, className);
}

const TabsRoot = React.forwardRef<
  React.ElementRef<typeof BaseTabs.Root>,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Root>
>(({ className, ...props }, ref) => <BaseTabs.Root ref={ref} className={className} {...props} />);
TabsRoot.displayName = "TabsRoot";

const TabsList = React.forwardRef<
  React.ElementRef<typeof BaseTabs.List>,
  React.ComponentPropsWithoutRef<typeof BaseTabs.List>
>(({ className, ...props }, ref) => (
  <BaseTabs.List
    ref={ref}
    className={mergeClassName(
      "inline-flex h-10 items-center justify-center rounded-none bg-grayscale-3 p-1 text-grayscale-11",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof BaseTabs.Tab>,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>
>(({ className, ...props }, ref) => (
  <BaseTabs.Tab
    ref={ref}
    className={mergeClassName(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-xs",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  React.ElementRef<typeof BaseTabs.Panel>,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>
>(({ className, ...props }, ref) => (
  <BaseTabs.Panel
    ref={ref}
    className={mergeClassName(
      "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";

const TabsIndicator = React.forwardRef<
  React.ElementRef<typeof BaseTabs.Indicator>,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Indicator>
>(({ className, ...props }, ref) => (
  <BaseTabs.Indicator ref={ref} className={className} {...props} />
));
TabsIndicator.displayName = "TabsIndicator";

const Tabs = Object.assign(TabsRoot, {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Tab: TabsTrigger,
  Content: TabsContent,
  Panel: TabsContent,
  Indicator: TabsIndicator,
});

export { Tabs, TabsRoot, TabsList, TabsTrigger, TabsContent, TabsIndicator };
