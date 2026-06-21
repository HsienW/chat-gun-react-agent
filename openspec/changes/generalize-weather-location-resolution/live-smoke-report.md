# Live Smoke Acceptance Report

Change: `generalize-weather-location-resolution`  
Date: 2026-06-21  
Method: real Open-Meteo geocoding + forecast APIs, no mocks, no model.  
Test file: `backend/src/tools/weather.live-smoke.test.ts`

## Result: PARTIAL FAILURE — BLOCKER FOUND

8 of 17 tests failed. All failures share a single root cause: **Open-Meteo geocoding does not support CJK (Chinese/Japanese/Korean) characters in the `name` query parameter.**

### CJK: all failed (5/8 failures)

| Test | Location | Actual status | Root cause |
|------|----------|--------------|------------|
| 9.1 | `台北` | `not_found` | Open-Meteo returns empty results for CJK |
| 9.2 | `臺北` | `not_found` | Same — no CJK support |
| 9.3 | `高雄鳳山` | `not_found` | Same |
| 9.4 | `北京市` | `not_found` | Same |
| 9.5 | `新加坡` | `needs_clarification` | Open-Meteo returns 3 Singapore results for `新加坡` — this passes partially but the candidates are for Singapore, not any Chinese-named entity. The query matched because Open-Meteo has an internal alias for Singapore, not because CJK works. |
| REL: Taipei | `台北` vs `臺北` | both `not_found` | Cannot prove same-entity relation |
| REL: SG | `Singapore` vs `新加坡` | Singapore → `success`, 新加坡 → `needs_clarification` | Cross-language equivalence fails |
| REL: punct | `台北` vs `台北。` | both `not_found` | Base query already fails |

### Latin/Unicode: all passed (9/17)

| Test | Location | Status |
|------|----------|--------|
| 9.6 | `Tokyo` | `success` |
| 9.7 | `São Paulo` | `success` |
| 9.8 | `München` | `success` |
| 9.9 | `Springfield` | `needs_clarification` (US-only, 5 candidates) |
| 9.10 | `中山` | `needs_clarification` (returns 2 results — Guangdong/Taiwan) |
| 9.11 | `DefinitelyNonExistentPlace12345` | `not_found` |
| 9.14 | Cancel via AbortSignal | `error` / `weather_cancelled` |
| 9.15 | No sensitive data leak | verified in JSON output |
| REL: country context | `中山` + `country: Taiwan` | `success` → TW |

Note: 9.10 `中山` returns results despite being CJK — this is because Open-Meteo has indexed "Zhongshan" as an admin1/admin2 name. This is the exception, not the rule: it works for well-known district names with Latin alias entries, not for Chinese city names (台北, 北京, etc.).

## Root Cause Analysis

Open-Meteo Geocoding API (`geocoding-api.open-meteo.com/v1/search`) uses a text index that only matches Latin-script names. The `language` parameter controls the language of *returned* metadata, not the accepted input encoding. Querying with `name=台北&language=zh` still returns zero results.

This means:
- The `buildQueryVariants` approach (query original, then `language=zh`, then `language=en`) cannot resolve CJK → Latin by itself.
- The system MUST either (a) transliterate CJK to Latin before geocoding, or (b) use the Planner LLM to produce a geocoding-friendly name.

## Impact on OpenSpec goals

Proposal Goal #1 — "使用者可以使用繁體中文、簡體中文、英文及常見 Unicode 地名查詢天氣" — **not met** for CJK-only queries.

Proposal Goal #5 — "系統不得以 hard-coded 自然語言 keyword regex...作為主要地點抽取修復策略" — the Planner LLM producing a geocoding-friendly Latin name from CJK input was identified as a valid approach in Design §2.1. But this capability is not yet implemented in a way that the tool can consume standalone (without a full agent run).

## Recommended action

This is a Blocker for the current change. Options:

1. **Add CJK→Latin transliteration step** in the normalizer/resolver, before geocoding. Use a lightweight library or the Planner LLM as part of the location query pipeline.
2. **Require the Planner to always output Latin names** — this moves the CJK→Latin responsibility to the Planner schema/prompt. The tool already passes `raw` separately, so the user's original Chinese text is preserved.
3. **Switch geocoding provider** — find a provider that supports CJK natively (e.g. Nominatim, Google Geocoding, etc.)

Option 2 is the least invasive and aligns with Design §2.1 (LLM may "從使用者問題中抽取 location"). The fix is a spec/prompt change, not a code change to the resolver pipeline.

## Verdict

`LIVE_SMOKE_FAILED_CJK_BLOCKER`
