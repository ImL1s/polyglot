import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
export const CONFIG_DIR = join(HOME, ".config", "jp-trainer");
export const PROFILE_FILE = join(CONFIG_DIR, "profile.yaml");
export const DB_FILE = join(CONFIG_DIR, "reviews.db");
export const IMMERSION_FLAG = join(CONFIG_DIR, "immersion.flag");
export const SEEDS_DIR = join(CONFIG_DIR, "seeds");
export const SESSION_TRACK_DIR = join(CONFIG_DIR, "sessions");
export const LOG_FILE = join(CONFIG_DIR, "jp.log");
