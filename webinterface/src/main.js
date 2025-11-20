import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import store from './store.js'
import Axios from 'axios'
import { vueDebounce } from 'vue-debounce'
import VueGtag from "vue-gtag-next"
import { createHead } from '@vueuse/head'
import { createBootstrap } from 'bootstrap-vue-next'

import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'

import './style/darkStyle.scss'

const app = createApp(App)

app.config.globalProperties.$http = Axios;

<<<<<<< HEAD
app.use(router)
app.use(store)
app.use(createBootstrap())
app.use(vueDebounce)
app.use(VueGtag, {
  config: { id: "INSERTTAG" }
})
app.use(createHead())
=======
Vue.use(BootstrapVue);
Vue.use(IconsPlugin);

Vue.use(vueDebounce, {
  listenTo: 'input'
});

// Google Analytics Configuration
// The GA_MEASUREMENT_ID can be set via environment variable VUE_APP_GA_MEASUREMENT_ID
// If not set, Google Analytics will be disabled (for development/testing)
const gaMeasurementId = process.env.VUE_APP_GA_MEASUREMENT_ID || null;

if (gaMeasurementId) {
  Vue.use(VueGtag, {
    config: { id: gaMeasurementId },
    appName: 'AutoTaskCalendar',
    pageTrackerScreenviewEnabled: true,
  }, router);
} else {
  // In development/testing without GA ID, use a stub implementation
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.info('Google Analytics is not configured. Set VUE_APP_GA_MEASUREMENT_ID environment variable to enable tracking.');
  }
  Vue.use(VueGtag, {
    config: { id: 'GA_MEASUREMENT_ID' },
    enabled: false,
    appName: 'AutoTaskCalendar',
  }, router);
}
>>>>>>> 01210f6 (Configure Google Analytics with environment variable support)

app.mount('#app')
