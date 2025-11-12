import Vue from 'vue'
import App from './App.vue'
import router from './router'
import { BootstrapVue, IconsPlugin } from 'bootstrap-vue'
import store from './store.js'
import Axios from 'axios'
import vueDebounce from 'vue-debounce'
import VueGtag from "vue-gtag"
import VueMeta from 'vue-meta'

// was commented out, why? 
import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue/dist/bootstrap-vue.css'

import './style/darkStyle.scss'

Vue.prototype.$http = Axios;

Vue.config.productionTip = false

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

Vue.use(VueMeta);

new Vue({
  router,
  store,
  render: h => h(App)
}).$mount('#app')
