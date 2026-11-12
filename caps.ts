export interface CapConfig {
	/** Target contextWindow value to cap affected models at. */
	cap: number;
	/** Only cap models whose native contextWindow exceeds this value. */
	appliesOver: number;
	/** Case-insensitive `model.id` substrings; `"*"` matches every model. */
	matchPatterns: string[];
	/** Per-model-id overrides. Always win over pattern matching. */
	models: Record<string, number>;
}

export interface CappableModel {
	id: string;
	contextWindow?: number | null;
}

export type CapCommand =
	| { kind: "status" }
	| { kind: "clear" }
	| { kind: "set"; cap: number };

/** Session cap that leaves every model at its native window. */
export const UNBOUNDED = Number.POSITIVE_INFINITY;

export const DEFAULT_CONFIG: CapConfig = {
	cap: 200_000,
	appliesOver: 200_000,
	matchPatterns: ["anthropic", "claude"],
	models: {},
};

// Shared across extension copies in one process so each sees the true native window.
const WINDOW_STATE = Symbol.for("pi-context-cap.window-state");

interface WindowState {
	native: number;
	applied: number;
}

type TrackedModel = CappableModel & { [WINDOW_STATE]?: WindowState };

/** Applies caps to models in place and returns how many are below their native window. */
export function applyCaps(models: Iterable<CappableModel>, cfg: CapConfig, sessionCap?: number): number {
	let cappedCount = 0;
	for (const model of models) {
		const native = nativeWindow(model);
		if (native === undefined) continue;
		const cap = resolveCap(model.id, native, cfg, sessionCap);
		const applied = cap === undefined ? native : Math.min(native, cap);
		setWindow(model, native, applied);
		if (applied < native) cappedCount++;
	}
	return cappedCount;
}

export function resolveCap(
	modelId: string,
	native: number,
	cfg: CapConfig,
	sessionCap?: number,
): number | undefined {
	if (sessionCap !== undefined) return sessionCap;
	const perModelCap = cfg.models[modelId];
	if (perModelCap !== undefined) return perModelCap;
	const overThresholds = native > cfg.appliesOver && native > cfg.cap;
	return overThresholds && matchesPatterns(modelId, cfg.matchPatterns) ? cfg.cap : undefined;
}

export function nativeWindow(model: CappableModel): number | undefined {
	const current = model.contextWindow;
	if (current == null || current <= 0) return undefined;
	const state = (model as TrackedModel)[WINDOW_STATE];
	// A different current value means another writer (for example an alias mirror) replaced it.
	return state && state.applied === current ? state.native : current;
}

export function parseCapCommand(args: string): CapCommand {
	const input = args.trim().toLowerCase();
	if (input === "" || input === "status") return { kind: "status" };
	if (["off", "reset", "clear", "default"].includes(input)) return { kind: "clear" };
	if (input === "max") return { kind: "set", cap: UNBOUNDED };
	return { kind: "set", cap: parseTokenCount(input) };
}

export function parseTokenCount(input: string): number {
	const match = /^(\d+(?:\.\d+)?)([km]?)$/.exec(input.trim().toLowerCase().replace(/[,_]/g, ""));
	if (!match) throw new Error(`invalid token count "${input}"; use e.g. 200000, 200k, or 1m`);
	const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
	const tokens = Math.round(Number(match[1]) * multiplier);
	if (tokens <= 0) throw new Error("cap must be greater than zero");
	return tokens;
}

export function formatTokens(tokens: number): string {
	return tokens === UNBOUNDED ? "max" : tokens.toLocaleString("en-US");
}

function matchesPatterns(modelId: string, patterns: string[]): boolean {
	const id = modelId.toLowerCase();
	return patterns.some((p) => p === "*" || id.includes(p.toLowerCase()));
}

function setWindow(model: CappableModel, native: number, applied: number): void {
	model.contextWindow = applied;
	Object.defineProperty(model, WINDOW_STATE, {
		value: { native, applied },
		configurable: true,
		enumerable: false,
		writable: true,
	});
}
