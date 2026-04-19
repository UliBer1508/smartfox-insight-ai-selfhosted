// App-Version wird zur Build-Zeit aus package.json (npm_package_version) injiziert.
// Quelle der Wahrheit: package.json auf GitHub. Versions-Bump dort (z.B. `npm version patch`).
// Fallback greift nur, wenn die Env-Variable beim Build nicht gesetzt ist.
declare const __APP_VERSION__: string;

export const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__ !== "1.0.0"
    ? __APP_VERSION__
    : "2.4.0";
