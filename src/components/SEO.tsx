import { Helmet } from "react-helmet-async";

const SITE_URL = "https://heizung.steinbockchalets-charge.com";

interface SEOProps {
  title: string;
  description: string;
  path: string;
  ogType?: "website" | "article";
}

/**
 * Per-route SEO tags. Overrides the static head in index.html.
 * The static index.html keeps sitewide og:* as a fallback for
 * social-preview crawlers that don't execute JS.
 */
export function SEO({ title, description, path, ogType = "website" }: SEOProps) {
  const url = `${SITE_URL}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={ogType} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </Helmet>
  );
}
