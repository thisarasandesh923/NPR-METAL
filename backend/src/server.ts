
import "dotenv/config";
import app from "./app.js";

const PORT = Number(process.env.PORT ?? 4000);

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid PORT configuration");
}

app.listen(PORT, () => {
  console.log(
    `NPR Backend running at http://localhost:${PORT}`
  );
});
