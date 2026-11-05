/**
 * Back-compat re-exports. Kept as a NON-client module so Server Components can
 * import CATEGORY_ICON without turning it into a client reference.
 *   - CATEGORY_ICON  → plain server-safe icon allowlist (category-meta)
 *   - EventThumb     → interactive client component (event-thumb)
 */
export { CATEGORY_ICON } from "./category-meta";
export { EventThumb } from "./event-thumb";
