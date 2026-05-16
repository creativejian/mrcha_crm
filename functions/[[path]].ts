import { app } from "../src/app";

export const onRequest = (context: { request: Request; env: unknown }) => app.fetch(context.request, context.env);
