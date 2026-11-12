import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyCaps,
	type CapConfig,
	DEFAULT_CONFIG,
	formatTokens,
	nativeWindow,
	parseCapCommand,
	parseTokenCount,
	UNBOUNDED,
} from "../caps.ts";

const CONFIG: CapConfig = { cap: 200_000, appliesOver: 200_000, matchPatterns: ["claude"], models: {} };

function claude(contextWindow = 1_000_000) {
	return { id: "claude-opus", contextWindow };
}

describe("applyCaps", () => {
	it("applies the configured cap to matching models", () => {
		const model = claude();
		assert.equal(applyCaps([model], CONFIG), 1);
		assert.equal(model.contextWindow, 200_000);
	});

	it("leaves non-matching models unchanged", () => {
		const model = { id: "gpt", contextWindow: 1_000_000 };
		assert.equal(applyCaps([model], CONFIG), 0);
		assert.equal(model.contextWindow, 1_000_000);
	});

	it("lets a per-model override win over patterns", () => {
		const model = claude();
		applyCaps([model], { ...CONFIG, models: { "claude-opus": 300_000 } });
		assert.equal(model.contextWindow, 300_000);
	});

	it("lets a session cap override config for every model", () => {
		const models = [claude(), { id: "gpt", contextWindow: 400_000 }];
		applyCaps(models, CONFIG, 128_000);
		assert.deepEqual(models.map((m) => m.contextWindow), [128_000, 128_000]);
	});

	it("raises a session cap above config up to the native window", () => {
		const model = claude();
		applyCaps([model], CONFIG);
		applyCaps([model], CONFIG, 500_000);
		assert.equal(model.contextWindow, 500_000);
		applyCaps([model], CONFIG, 2_000_000);
		assert.equal(model.contextWindow, 1_000_000);
	});

	it("restores native windows for a max session cap", () => {
		const models = [claude(), { id: "claude-sonnet", contextWindow: 1_000_000 }];
		applyCaps(models, { ...CONFIG, models: { "claude-sonnet": 100_000 } });
		assert.equal(applyCaps(models, CONFIG, UNBOUNDED), 0);
		assert.deepEqual(models.map((m) => m.contextWindow), [1_000_000, 1_000_000]);
	});

	it("restores the configured cap when the session cap clears", () => {
		const model = claude();
		applyCaps([model], CONFIG, 100_000);
		applyCaps([model], CONFIG);
		assert.equal(model.contextWindow, 200_000);
	});

	it("treats an externally replaced window as the new native window", () => {
		const model = claude();
		applyCaps([model], CONFIG);
		model.contextWindow = 400_000;
		assert.equal(nativeWindow(model), 400_000);
	});

	it("skips models without a positive window", () => {
		assert.equal(applyCaps([{ id: "claude", contextWindow: 0 }, { id: "claude" }], DEFAULT_CONFIG), 0);
	});
});

describe("parseCapCommand", () => {
	it("returns status for empty input", () => assert.deepEqual(parseCapCommand("  "), { kind: "status" }));
	it("returns clear for off", () => assert.deepEqual(parseCapCommand("OFF"), { kind: "clear" }));
	it("returns an unbounded cap for max", () => assert.deepEqual(parseCapCommand("Max"), { kind: "set", cap: UNBOUNDED }));
	it("formats an unbounded cap as max", () => assert.equal(formatTokens(UNBOUNDED), "max"));
	it("returns set for a token count", () => assert.deepEqual(parseCapCommand("200k"), { kind: "set", cap: 200_000 }));
});

describe("parseTokenCount", () => {
	it("parses suffixes and separators", () => {
		assert.deepEqual(["1m", "1.5M", "200,000", "128_000"].map(parseTokenCount), [1_000_000, 1_500_000, 200_000, 128_000]);
	});

	it("rejects invalid input", () => assert.throws(() => parseTokenCount("lots"), /invalid token count/));
	it("rejects zero", () => assert.throws(() => parseTokenCount("0"), /greater than zero/));
});
