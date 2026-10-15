// Ports come from the parent `npm run dev` process; see instance.js at the repo root.
const webPort = parseInt(process.env.AUTOTASKCALENDAR_WEB_PORT, 10) || 8080;
const apiPort = parseInt(process.env.AUTOTASKCALENDAR_API_PORT, 10) || 3000;

module.exports = {
    // Express serves the bundle straight from the repo root.
    outputDir: '../dist',
    configureWebpack: {
        devtool: 'source-map'
    },
    css: {
        loaderOptions: {
            sass: {
                // Bootstrap's @import-based Sass emits hundreds of deprecation warnings
                // that we cannot act on until it migrates to @use.
                sassOptions: { quietDeps: true, silenceDeprecations: ['import', 'global-builtin', 'color-functions'] }
            }
        }
    },
    devServer: {
        port: webPort,
        host: '0.0.0.0',
        // Reached through a forwarded port, so the outer host is never one we can predict.
        allowedHosts: 'all',
        // Webpack's progress reporter prints hundreds of lines when stdout is not a TTY.
        client: {
            progress: false,
            // Placeholders: the client swaps 0.0.0.0/0 for window.location, so hot reload
            // dials the port the browser actually used. See docs/PROXIED_ACCESS.md.
            webSocketURL: 'auto://0.0.0.0:0/ws'
        },
        proxy: {
            '^/api': {
                target: `http://127.0.0.1:${apiPort}/`,
                changeOrigin: true,
                // Passes the browser's host on, so the API can tell what origin to expect.
                xfwd: true,
                secure: false,
                pathRewrite: { '^/api/': '/api/' }
            }
        }
    }
}
