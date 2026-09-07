import { useEffect, type ReactNode } from "react";

export function StoryTheme({
  children,
  theme,
}: {
  readonly children: ReactNode;
  readonly theme: "dark" | "light";
}) {
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.dataset.theme;
    const previouslyDark = root.classList.contains("dark");
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");

    return () => {
      if (previousTheme === undefined) {
        delete root.dataset.theme;
      } else {
        root.dataset.theme = previousTheme;
      }
      root.classList.toggle("dark", previouslyDark);
    };
  }, [theme]);

  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}
