/**
 * The complete PostHog configuration (D-024). Pure, so tests can prove every
 * privacy switch; the SDK itself is imported only by the client runtime after
 * consent.
 */
import type { PostHogConfig } from "posthog-js/dist/module.full.no-external";
import { POSTHOG_API_HOST } from "./config.ts";
import { autocaptureUrlAllowlist, isAnalyticsRoute } from "./routes.ts";
import { sanitizeEvent, sanitizeUrl, type CaptureLike } from "./sanitize.ts";
import {
  AUTOCAPTURE_IGNORE_SELECTORS,
  REPLAY_BLOCK_SELECTOR,
  maskReplayAttribute,
  maskReplayInput,
  maskReplayText,
} from "./privacy.ts";

export interface RuntimeGuards {
  /** window.location.origin */
  origin: string;
  /** Current pathname at send time. */
  pathname: () => string;
  /** Consent granted, no browser signal, on an allowed route, not suspended. */
  mayCapture: () => boolean;
}

export function buildPostHogConfig(guards: RuntimeGuards): Partial<PostHogConfig> {
  const origin = guards.origin;
  return {
    api_host: POSTHOG_API_HOST,
    ui_host: "https://eu.posthog.com",
    defaults: "2026-08-30",

    // Anonymous only: identify() is never called; no person profiles.
    person_profiles: "identified_only",
    // Consent is ours: start opted out, opt in explicitly after consent.
    opt_out_capturing_by_default: true,
    // While opted out (before opt-in / after withdrawal) nothing is persisted.
    opt_out_persistence_by_default: true,
    // Never tag a visitor as an internal/test *person* (that would enable
    // person processing, e.g. on localhost).
    internal_or_test_user_hostname: null,
    respect_dnt: true,
    persistence: "localStorage",
    cross_subdomain_cookie: false,
    secure_cookie: true,

    // No feature flags (/flags), surveys, tours, experiments, site apps (CDP
    // destinations), toolbar or external code. The project's remote config is
    // still read as JSON (never executable) because session replay starts only
    // when the project enables it there; every capture switch below is set
    // explicitly, so remote config cannot turn on anything disabled here.
    advanced_disable_flags: false,
    advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    advanced_disable_toolbar_metrics: true,
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    opt_in_site_apps: false,
    disable_external_dependency_loading: true,

    // D-025 error tracking: uncaught errors and rejections only (never console
    // errors), rate limited, no exception steps. Every $exception passes the
    // same before_send sanitizer, which redacts messages/stacks.
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    error_tracking: {
      exceptionRateLimiterRefillRate: 1,
      exceptionRateLimiterBucketSize: 5,
      captureExtensionExceptions: false,
      exception_steps: { enabled: false },
    },
    // No console, performance/network or web-vitals capture.
    capture_performance: false,
    capture_dead_clicks: false,
    rageclick: false,
    enable_recording_console_log: false,

    // URLs: same-origin pathname only; no referrer/campaign/hash.
    save_referrer: false,
    save_campaign_params: false,
    custom_campaign_params: [],
    disable_capture_url_hashes: true,
    get_current_url: () => {
      const p = guards.pathname();
      return origin + (p || "/");
    },
    mask_personal_data_properties: true,

    // Page views on Next client navigation, page leave, scroll depth.
    capture_pageview: "history_change",
    capture_pageleave: true,
    disable_scroll_properties: false,
    request_batching: false,

    // Click/submit autocapture on approved URLs only; no text, no values.
    autocapture: {
      url_allowlist: autocaptureUrlAllowlist(origin),
      dom_event_allowlist: ["click", "submit"],
      element_allowlist: ["a", "button", "form", "input", "select"],
      css_selector_ignorelist: AUTOCAPTURE_IGNORE_SELECTORS,
      element_attribute_ignorelist: ["aria-label", "title", "alt", "placeholder", "value", "name", "id"],
      capture_copied_text: false,
    },
    mask_all_text: true,
    mask_all_element_attributes: false,

    // Click heatmaps (scrollmaps come from the page-leave scroll properties).
    capture_heatmaps: true,

    // Session replay: all inputs masked, text masked by default, media/QR/
    // canvas/blocked regions removed, no console/network/canvas recording.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskInputOptions: {
        color: true,
        date: true,
        email: true,
        month: true,
        number: true,
        range: true,
        search: true,
        tel: true,
        text: true,
        time: true,
        url: true,
        week: true,
        textarea: true,
        select: true,
        password: true,
        hidden: true,
      },
      maskInputFn: (text) => maskReplayInput(text),
      maskTextSelector: "*",
      maskTextFn: (text, element) => maskReplayText(text, element),
      maskAttributeFn: (name, value) => maskReplayAttribute(name, value, origin),
      blockSelector: REPLAY_BLOCK_SELECTOR,
      blockClass: "ph-no-capture",
      recordHeaders: false,
      recordBody: false,
      recordCrossOriginIframes: false,
      collectFonts: false,
      captureCanvas: { recordCanvas: false },
      // Network capture is off; the SDK also routes the replay page URL (rrweb
      // Meta href) through these. Keep it as the same-origin approved path
      // (dropping it would break playback); anything else is removed.
      maskCapturedNetworkRequestFn: (req) => {
        const url = sanitizeUrl(req.name, origin);
        return url && isAnalyticsRoute(url.slice(origin.length) || "/") ? { ...req, name: url } : null;
      },
      maskNetworkRequestFn: (req) => {
        const url = sanitizeUrl(req.url, origin);
        return url && isAnalyticsRoute(url.slice(origin.length) || "/") ? { ...req, url } : null;
      },
    },

    // The final gate: every event is sanitized (or dropped) before send.
    before_send: (result) => {
      if (!guards.mayCapture()) return null;
      return sanitizeEvent(result as unknown as CaptureLike, {
        origin,
        pathname: guards.pathname(),
      }) as unknown as typeof result;
    },
  };
}
