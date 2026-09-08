/** Stands in for the `cloudflare:workers` module outside the Workers runtime. */
export const env = {}

/**
 * In the Workers runtime this keeps the isolate alive until `promise` settles.
 * Outside it, just run the promise and swallow rejections (the only caller,
 * `sendEmail`, never throws anyway).
 */
export const waitUntil = (promise) => {
  Promise.resolve(promise).catch(() => {})
}
