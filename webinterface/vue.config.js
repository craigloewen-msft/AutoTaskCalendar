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
        // Webpack's progress reporter prints hundreds of lines when stdout is not a TTY.
        client: { progress: false },
        proxy: {
            '^/api': {
                target: `http://127.0.0.1:${apiPort}/`,
                changeOrigin: true,
                secure: false,
                pathRewrite: { '^/api/': '/api/' }
            }
        }
    }
}
