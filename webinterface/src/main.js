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

// Initialize the app asynchronously to fetch runtime config
async function initApp() {
  const app = createApp(App)

  app.config.globalProperties.$http = Axios;

  app.use(router)
  app.use(store)
  app.use(createBootstrap())
  app.use(vueDebounce)

  // Google Analytics Configuration
  // Try to get GA measurement ID from runtime config first, then fall back to build-time env var
  let gaMeasurementId = null;
  
  try {
    // Fetch runtime configuration from the server
    const response = await Axios.get('/api/config');
    if (response.data && response.data.success && response.data.config) {
      gaMeasurementId = response.data.config.gaMeasurementId;
    }
  } catch (error) {
    // If fetching runtime config fails, fall back to build-time environment variable
    // eslint-disable-next-line no-console
    console.warn('Failed to fetch runtime config, falling back to build-time configuration:', error.message);
  }
  
  // Fall back to build-time environment variable if runtime config didn't provide a value
  if (!gaMeasurementId) {
    gaMeasurementId = process.env.VUE_APP_GA_MEASUREMENT_ID || null;
  }

  if (gaMeasurementId) {
    app.use(VueGtag, {
      config: { id: gaMeasurementId },
      appName: 'AutoTaskCalendar',
      pageTrackerScreenviewEnabled: true,
    }, router);
    // eslint-disable-next-line no-console
    console.info('Google Analytics initialized with ID:', gaMeasurementId);
  } else {
    // In development/testing without GA ID, use a stub implementation
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.info('Google Analytics is not configured. Set GA_MEASUREMENT_ID environment variable on the server or VUE_APP_GA_MEASUREMENT_ID at build time to enable tracking.');
    }
    app.use(VueGtag, {
      config: { id: 'GA_MEASUREMENT_ID' },
      enabled: false,
      appName: 'AutoTaskCalendar',
    }, router);
  }

  app.use(createHead())

  app.mount('#app')
}

// Start the app
initApp().catch(error => {
  // eslint-disable-next-line no-console
  console.error('Failed to initialize app:', error);
});
