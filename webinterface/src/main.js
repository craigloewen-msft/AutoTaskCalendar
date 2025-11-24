import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store.js'
import Axios from 'axios'
import { vueDebounce } from 'vue-debounce'
import { createGtag } from "vue-gtag"
import { createHead } from '@vueuse/head'
import { createBootstrap } from 'bootstrap-vue-next'

import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'

import './style/darkStyle.scss'

const app = createApp(App)

app.config.globalProperties.$http = Axios;

app.use(router)
app.use(store)
app.use(createBootstrap())
app.use(vueDebounce)

// Google Analytics Configuration
// The GA_MEASUREMENT_ID can be set via environment variable VUE_APP_GA_MEASUREMENT_ID
// If not set, Google Analytics will be disabled (for development/testing)
const gaMeasurementId = process.env.VUE_APP_GA_MEASUREMENT_ID || null;

if (gaMeasurementId) {
  const gtag = createGtag({
    tagId: gaMeasurementId,
    pageTracker: {
      router: router
    }
  });
  app.use(gtag);
} else {
  console.info('Google Analytics is not configured. Set VUE_APP_GA_MEASUREMENT_ID environment variable to enable tracking.');
}

app.use(createHead())

app.mount('#app')
