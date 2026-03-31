import { Hono } from "hono";
import { getConfig } from "./config";
import { createDb } from "./db/connection";
import { createSlackRouter } from "./slack/routes";

const config = getConfig();
const db = createDb(config.DATABASE_URL);

const app = new Hono();

app.get("/health", (c) => {
	return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

const slack = createSlackRouter({ db });
app.route("/slack", slack);

export default app;
