"use client";

export function AppFooter() {
  const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "My App";

  return (
    <footer className="px-6 py-3 text-center text-sm text-muted-foreground">
      {appName} - {new Date().getFullYear()}
    </footer>
  );
}
