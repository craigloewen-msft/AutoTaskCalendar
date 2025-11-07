module.exports = {
    configureWebpack: {
        devtool: 'source-map'
    },
    devServer: {
        port: 8080,
        host: '0.0.0.0',
        proxy: {
            '^/api': {
                target: 'http://0.0.0.0:3000/',
                changeOrigin: true,
                secure: false,
                pathRewrite: { '^/api/': '/api/' },
                logLevel: 'debug',
            }
        }
    }
}