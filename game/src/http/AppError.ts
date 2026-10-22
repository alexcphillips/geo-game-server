/**
 * The one way to reject a request. Throw it from anywhere in a module and the
 * central error handler turns it into the right status + body.
 *
 * Controllers should never call `res.status(4xx).send(...)` by hand: doing it
 * here keeps the error shape identical across every endpoint.
 */
export class AppError extends Error {
    readonly status: number;
    /** For a 429: when to try again, sent as `Retry-After`. */
    readonly retryAfterSeconds?: number;

    constructor(status: number, message: string, retryAfterSeconds?: number) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
    }

    static tooManyRequests(message: string, retryAfterSeconds: number) {
        return new AppError(429, message, retryAfterSeconds);
    }

    static badRequest(message: string) {
        return new AppError(400, message);
    }

    static unauthorized(message: string) {
        return new AppError(401, message);
    }

    static forbidden(message: string) {
        return new AppError(403, message);
    }

    static notFound(message: string) {
        return new AppError(404, message);
    }
}
