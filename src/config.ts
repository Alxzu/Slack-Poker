import { z } from "zod";

const envSchema = z.object({
	SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
	SLACK_SIGNING_SECRET: z.string().optional(),
	SLACK_APP_TOKEN: z.string().startsWith("xapp-").optional(),
	SLACK_MODE: z.enum(["socket", "http"]).default("socket"),
	DATABASE_URL: z.string().url(),
	REDIS_URL: z.string(),
	ENCRYPTION_KEY: z.string().min(64, "Must be a 256-bit hex key (64 chars)"),
	PORT: z.coerce.number().default(3000),
	MIN_BUY_IN: z.coerce.number().default(100),
	MAX_BUY_IN: z.coerce.number().default(5000),
	DEFAULT_BUY_IN: z.coerce.number().default(500),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
	if (!_config) {
		_config = envSchema.parse(process.env);
	}
	return _config;
}
