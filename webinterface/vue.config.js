// Ports are derived per instance so several AutoTaskCalendar instances can run side by
// side. `npm run dev` exports these; see instance.js at the repo root for the derivation.
const webPort = parseInt(process.env.AUTOTASKCALENDAR_WEB_PORT, 10) || 8080;
const apiPort = parseInt(process.env.AUTOTASKCALENDAR_API_PORT, 10) || 3000;

module.exports = {
    configureWebpack: {
        devtool: 'source-map'
    },
    devServer: {
        port: webPort,
        host: '0.0.0.0',
        proxy: {
            '^/api': {
                target: `http://127.0.0.1:${apiPort}/`,
                changeOrigin: true,
                secure: false,
                pathRewrite: { '^/api/': '/api/' },
                logLevel: 'debug',
            }
        }
    }
}
