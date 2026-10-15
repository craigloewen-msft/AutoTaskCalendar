'use strict';

/**
 * Build-time prerendering for the public pages.
 *
 * The app is client-rendered, so the HTML a crawler receives is an empty <div id="app">
 * with no content and no per-page meta tags. Google executes JavaScript, but Bing and
 * every link-preview bot (Slack, LinkedIn, Twitter, iMessage) largely do not. This plugin
 * renders each public route once at build time and writes the resulting HTML to disk, so
 * those pages ship with real content, titles and Open Graph tags.
 *
 * It drives Playwright's Chromium, which the repo already uses for its test suite, so
 * nothing extra is downloaded. See docs/SEO.md.
 */

const http = require('http');
const path = require('path');

const PLUGIN = 'PrerenderPlugin';

// Serves the just-built assets from memory so a route can be rendered before anything
// reaches disk. `shell` is the pristine index.html, captured before the render loop
// starts overwriting it: serving the live asset would hand later routes the *rendered*
// home page as their starting document.
function createAssetServer(compilation, shell) {
    const read = (urlPath) => {
        const name = decodeURIComponent(urlPath.replace(/^\//, '').split('?')[0]);
        const asset = compilation.getAsset(name);
        return asset ? asset.source.source() : null;
    };

    const types = {
        '.js': 'application/javascript', '.mjs': 'application/javascript',
        '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
        '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon',
        '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
        '.map': 'application/json',
    };

    return http.createServer((req, res) => {
        const urlPath = req.url.split('?')[0];
        // Every navigable route starts from the untouched shell, never from an asset the
        // loop may already have replaced.
        let body = urlPath === '/' ? shell : read(urlPath);

        // Unknown path: this is the SPA, so hand back the shell and let the router decide.
        if (body === null || body === undefined) body = shell;
        if (body === null || body === undefined) {
            res.writeHead(404);
            return res.end('not found');
        }

        const ext = path.extname(urlPath);
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/html' });
        return res.end(body);
    });
}

class PrerenderPlugin {
    constructor(options = {}) {
        this.routes = options.routes || ['/'];
    }

    // '/' -> index.html, '/about' -> about.html. Flat files rather than about/index.html,
    // because a directory makes express.static redirect /about to /about/, which then
    // disagrees with the canonical URL the page declares.
    static assetNameFor(route) {
        if (route === '/') return 'index.html';
        return `${route.replace(/^\//, '').replace(/\/$/, '')}.html`;
    }

    apply(compiler) {
        compiler.hooks.thisCompilation.tap(PLUGIN, (compilation) => {
            compilation.hooks.processAssets.tapPromise(
                {
                    name: PLUGIN,
                    stage: compilation.constructor.PROCESS_ASSETS_STAGE_REPORT,
                },
                async () => {
                    try {
                        await this.render(compilation);
                    } catch (error) {
                        // Prerendering is an enhancement. A broken build is worse than an
                        // unprerendered one, so warn loudly and ship the normal SPA.
                        compilation.warnings.push(
                            new Error(`${PLUGIN}: skipped prerendering (${error.message})`)
                        );
                    }
                }
            );
        });
    }

    async render(compilation) {
        // Playwright is a devDependency of the repo root, not of webinterface/.
        const { chromium } = require('@playwright/test');

        const { RawSource } = compilation.compiler.webpack.sources;

        const shellAsset = compilation.getAsset('index.html');
        if (!shellAsset) throw new Error('no index.html to prerender from');
        const shell = shellAsset.source.source();

        // Keep the untouched shell. Routes that are not prerendered must be served this,
        // not a copy of the home page: otherwise every such URL ships home's title,
        // description and canonical until the app boots. See app.js.
        compilation.emitAsset('app.html', new RawSource(shell));

        const server = createAssetServer(compilation, shell);
        // Without the error path this promise can never settle, hanging the whole build.
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });

        let browser;
        try {
            const port = server.address().port;
            browser = await chromium.launch({
                // Containerised CI usually has no sandbox and a small /dev/shm.
                args: ['--no-sandbox', '--disable-dev-shm-usage'],
            });

            for (const route of this.routes) {
                const page = await browser.newPage();
                try {
                    await page.goto(`http://127.0.0.1:${port}${route}`, {
                        waitUntil: 'networkidle',
                        timeout: 30000,
                    });
                    // The head is written by @vueuse/head after mount, so wait for the
                    // app to have produced something before snapshotting.
                    await page.waitForSelector('#app > *', { timeout: 15000 });

                    const html = await page.content();
                    const name = PrerenderPlugin.assetNameFor(route);

                    const source = new RawSource(html);
                    // '/' overwrites the shell webpack already emitted; others are new.
                    if (compilation.getAsset(name)) {
                        compilation.updateAsset(name, source);
                    } else {
                        compilation.emitAsset(name, source);
                    }
                } finally {
                    await page.close().catch(() => {});
                }
            }
        } finally {
            // Each step independently, so a failing close cannot skip the next one or
            // mask the error that brought us here.
            if (browser) await browser.close().catch(() => {});
            await new Promise((resolve) => server.close(resolve));
        }
    }
}

module.exports = PrerenderPlugin;
