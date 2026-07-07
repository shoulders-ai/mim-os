import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PopoutShell from './components/popout/PopoutShell.vue'
import './styles.css'

const app = createApp(PopoutShell)
app.use(createPinia())
app.mount('#popout')
