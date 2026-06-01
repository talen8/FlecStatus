import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installVueQuery } from './stores/query'
import './styles/main.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)
installVueQuery(app)

app.mount('#app')
