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

app.use(router)
app.use(store)
app.use(createBootstrap())
app.use(vueDebounce)
app.use(VueGtag, {
  config: { id: "INSERTTAG" }
})
app.use(createHead())

app.mount('#app')
