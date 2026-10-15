/**
 * One place that knows the site's public identity. Everything SEO reads from here.
 *
 * The origin is a build-time constant rather than `window.location.origin` because the
 * prerenderer runs against a throwaway localhost server -- reading the runtime origin
 * would bake "http://localhost:<port>" into every prerendered canonical and og:url.
 * Override with VUE_APP_SITE_URL at build time.
 */

const SITE_URL = (process.env.VUE_APP_SITE_URL || 'https://autotaskcalendar.com').replace(/\/$/, '');

const SITE_NAME = 'AutoTaskCalendar';

const SITE_TAGLINE = 'Automatic task scheduling';

// Sized 1200x630 for Open Graph / Twitter summary_large_image. PNG, not SVG: most
// social platforms refuse to render SVG previews.
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

const DEFAULT_DESCRIPTION =
    'AutoTaskCalendar turns your task list into a realistic schedule. It places each task '
    + 'into your working hours automatically, reschedules what slips, and keeps everything '
    + 'in one calendar.';

// Absolute URL for a router path, which is what canonical and og:url require.
function absoluteUrl(path = '/') {
    if (!path || path === '/') return `${SITE_URL}/`;
    return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export {
    SITE_URL,
    SITE_NAME,
    SITE_TAGLINE,
    DEFAULT_OG_IMAGE,
    DEFAULT_DESCRIPTION,
    absoluteUrl,
};
