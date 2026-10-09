import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import adminRouter from "./routes/admin";
import { logger } from "./lib/logger";

const app: Express = express();
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set to protect ScrapCook browser sessions.");
}

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cookieParser(sessionSecret));
app.use(cors());
// Only the scanner accepts photo payloads; other routes retain the small default.
app.use("/api/scanIngredients", express.json({ limit: "2mb" }),
  ((error, _req, res, _next) => {
    const oversized = error.status === 413;
    res.status(oversized ? 413 : 400).json({
      error: oversized ? "Photo payload too large. Please resize the image." : "Invalid scan request.",
    });
  }) as express.ErrorRequestHandler);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(adminRouter);
app.use("/api", router);

export default app;
