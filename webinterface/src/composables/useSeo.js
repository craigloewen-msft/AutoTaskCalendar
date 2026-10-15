/**
 * Per-page SEO tags.
 *
 * Call this from a view's `setup()`. It emits a complete, consistent tag set: title,
 * description, canonical, Open Graph and Twitter Card.
 *
 *   setup() {
 *     useSeo({
 *       title: 'About',
 *       description: 'What AutoTaskCalendar does and how it schedules your work.',
 *       path: '/about',
 *     });
 *   }
 *
 * Private pages pass `noindex: true` and may omit description/path.
 *
 * Do NOT add a `metaInfo` option to a component. That is the vue-meta 2.x API; this app
 * uses @vueuse/head and silently ignores it. See docs/SEO.md.
 */

import { computed, unref } from 'vue';
import { useHead } from '@vueuse/head';

import { SITE_NAME, DEFAULT_OG_IMAGE, absoluteUrl } from '../seo/siteConfig';

export function useSeo(options = {}) {
    // Accept plain values, refs or getters so a page can derive a title from its data.
    const resolve = (value) => (typeof value === 'function' ? value() : unref(value));

    const title = computed(() => resolve(options.title));
    const description = computed(() => resolve(options.description));
    const noindex = computed(() => !!resolve(options.noindex));
    const url = computed(() => {
        const path = resolve(options.path);
        return path ? absoluteUrl(path) : null;
    });

    // The " | AutoTaskCalendar" suffix comes from the titleTemplate in App.vue, so a
    // page sets only its own name here. og/twitter titles need the full string.
    const fullTitle = computed(() => {
        const value = title.value;
        return value ? `${value} | ${SITE_NAME}` : SITE_NAME;
    });

    const meta = computed(() => {
        const tags = [];

        if (description.value) {
            tags.push({ name: 'description', content: description.value });
            tags.push({ property: 'og:description', content: description.value });
            tags.push({ name: 'twitter:description', content: description.value });
        }

        tags.push({ property: 'og:title', content: fullTitle.value });
        tags.push({ name: 'twitter:title', content: fullTitle.value });

        if (url.value) {
            tags.push({ property: 'og:url', content: url.value });
        }

        // Indexable pages inherit the site-wide image; private ones need no preview.
        if (!noindex.value) {
            tags.push({ property: 'og:image', content: DEFAULT_OG_IMAGE });
            tags.push({ name: 'twitter:image', content: DEFAULT_OG_IMAGE });
        }

        tags.push({
            name: 'robots',
            content: noindex.value ? 'noindex, nofollow' : 'index, follow',
        });

        return tags;
    });

    const link = computed(() => (
        // Only an indexable page should claim a canonical URL.
        !noindex.value && url.value ? [{ rel: 'canonical', href: url.value }] : []
    ));

    useHead({ title, meta, link });
}

export default useSeo;
