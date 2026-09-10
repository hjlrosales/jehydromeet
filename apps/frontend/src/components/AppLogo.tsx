interface AppLogoProps {
  className?: string;
  title?: string;
}

export function AppLogo({ className = 'h-8 w-8', title = 'Jehydro Meet' }: AppLogoProps) {
  return (
    <span className={`inline-flex ${className}`} aria-label={`${title} logo`} role="img">
      <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="app-logo-mark" x1="10" x2="54" y1="8" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#14b8a6" />
            <stop offset="0.55" stopColor="#2563eb" />
            <stop offset="1" stopColor="#0f766e" />
          </linearGradient>
          <linearGradient id="app-logo-shine" x1="18" x2="44" y1="14" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.92" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.48" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="#082f49" />
        <path fill="url(#app-logo-mark)" d="M14 21.5A7.5 7.5 0 0 1 21.5 14h20A7.5 7.5 0 0 1 49 21.5v21A7.5 7.5 0 0 1 41.5 50h-20A7.5 7.5 0 0 1 14 42.5v-21Z" />
        <path fill="url(#app-logo-shine)" d="M20 23.5A3.5 3.5 0 0 1 23.5 20h15a3.5 3.5 0 0 1 3.5 3.5v8.75a3.5 3.5 0 0 1-3.5 3.5h-15a3.5 3.5 0 0 1-3.5-3.5V23.5Z" />
        <path fill="#ccfbf1" d="m44 27 7.1-3.85A2 2 0 0 1 54 24.9v14.2a2 2 0 0 1-2.9 1.75L44 37V27Z" />
        <path fill="#0f172a" fillOpacity="0.22" d="M20 39.15c3.86-2.76 7.57-2.35 11.34-.33 4.04 2.17 8.07 2.06 12.66-.86V42.5A7.5 7.5 0 0 1 36.5 50h-15A7.5 7.5 0 0 1 14 42.5v-.66c2.03-.22 3.99-1.07 6-2.69Z" />
        <path fill="#ecfeff" d="M22 43.6c3.34-2.7 6.46-2.2 9.72-.3 4.63 2.7 9.22 2.1 14.28-2.45v4.25C40.6 49.37 35.5 49.92 30.4 47c-2.73-1.56-5.01-1.98-7.66.18-1.84 1.5-3.76 2.34-5.74 2.63v-4.08c1.72-.3 3.38-.83 5-2.13Z" />
        <path fill="#075985" d="M32.1 24h4.8v12.2c0 4.93-3.04 7.8-7.52 7.8-3.17 0-5.5-1.45-6.68-3.94l3.68-2.2c.63 1.26 1.55 1.9 2.82 1.9 1.87 0 2.9-1.2 2.9-3.55V24Z" />
      </svg>
    </span>
  );
}
