// App-Version wird zur Build-Zeit direkt aus package.json gelesen
// (siehe vite.config.ts -> define.__APP_VERSION__).
// Single Source of Truth: package.json. Bump dort -> nächster Build zeigt neue Version.
declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;
