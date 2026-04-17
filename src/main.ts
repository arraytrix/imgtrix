import posthog from 'posthog-js'
import App from './App.svelte'

posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: import.meta.env.VITE_POSTHOG_HOST,
  person_profiles: 'identified_only',
})

const app = new App({
  target: document.getElementById('app')!
})

export default app
