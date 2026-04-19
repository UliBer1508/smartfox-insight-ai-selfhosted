import { APP_VERSION } from "@/lib/version";

export function Footer() {
  const version = APP_VERSION;
  const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;
  const year = new Date().getFullYear();
  // Short build hash derived from build time — lets us verify on published which build is live
  const buildHash = buildTime
    ? Math.abs(
        Array.from(buildTime).reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)
      )
        .toString(36)
        .slice(0, 6)
    : null;

  return (
    <footer className="border-t bg-card/30 backdrop-blur-sm mt-8 pb-20 md:pb-4">
      <div className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <div>
          © {year} Fronius Smart AI. Alle Rechte vorbehalten.
        </div>
        <div className="flex items-center gap-2 font-mono">
          <span>v{version}</span>
          {buildTime && (
            <>
              <span className="opacity-50">·</span>
              <span>Build {new Date(buildTime).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</span>
            </>
          )}
          {buildHash && (
            <>
              <span className="opacity-50">·</span>
              <span title="Build-Hash zur Verifikation des aktiven Bundles">#{buildHash}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
