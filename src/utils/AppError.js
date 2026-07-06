// A user-facing error that route handlers and middleware can throw
// when the caller did something wrong (4xx). The errorHandler
// (middlewares/errorHandler.js) already classifies any error with a
// `.status` in [400, 500) as a client error and echoes its .message
// to the response — so constructing one of these is the way to say
// "the request was bad, and here's why."
//
// Use for:
//   - 401 (missing/expired/bad-signature auth — though the JWT
//     library's own errors are also handled by name in errorHandler)
//   - 403 (forbidden — wrong role, wrong org type, suspended account)
//   - 404 (resource not found, when you want it to flow through the
//     global handler rather than calling res.status(404).json directly)
//
// Do NOT use for 5xx — those are programming bugs or dependency
// failures, and the right behavior is to let them surface as 500
// with a generic message.

export class AppError extends Error {
  /**
   * @param {number} status  HTTP status code, 400-499.
   * @param {string} message Human-readable reason, safe to echo to the client.
   */
  constructor(status, message) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}
