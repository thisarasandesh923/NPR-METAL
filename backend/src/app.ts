
import express from "express";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "NPR Metal Crusher API",
    timestamp: new Date().toISOString()
  });
});

export default app;
