import posthog from 'posthog-js'
import * as Sentry from '@sentry/electron/renderer'

const ANON_ID_KEY = 'imgtrix_anon_id'

function getAnonId(): string {
  let id = localStorage.getItem(ANON_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ANON_ID_KEY, id)
  }
  return id
}

export function initTelemetry(): void {
  Sentry.init({
    dsn: 'https://9ddbf4c6795bb9aad963ce159556cd2f@o4511221561229312.ingest.us.sentry.io/4511221563457536',
  })

  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    persistence: 'localStorage',
  })

  posthog.identify(getAnonId())
}

export function track(event: string, properties?: Record<string, unknown>): void {
  posthog.capture(event, properties)
}
