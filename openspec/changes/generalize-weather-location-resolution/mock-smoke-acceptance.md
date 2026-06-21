# Mock Smoke Acceptance Report

Change: `generalize-weather-location-resolution`

Status: mock smoke acceptance added.

live acceptance pending

This report records a deterministic smoke acceptance path for the 9.x manual acceptance matrix. It is intended to unblock the OpenSpec first-run experience without consuming Gemini API quota, Open-Meteo live network calls, or any external paid service.

This is not formal product live acceptance. The 9.x manual acceptance tasks remain pending until a live run with the real planner model, real provider network, and browser streaming/cancel behavior is completed.

## Harness

- Backend: `backend/src/tools/weather.mock-smoke.test.ts`
- Frontend: `frontend/src/components/WeatherToolResult.test.tsx`
- Model: not called; weather requests are deterministic inputs to `current_weather`.
- Provider: mocked `fetch` responses for Open-Meteo geocoding and forecast endpoints.
- Network: no live Open-Meteo calls.

## 9.x Coverage

All tasks 9.1–9.15 are mock-verified. Live acceptance (real Planner model, real Open-Meteo, real browser streaming/cancel) is pending — see tasks.md 9.16.

| Task | Mock smoke coverage | Live acceptance status |
| --- | --- | --- |
| 9.1 `台北現在天氣如何？` | Mock geocoding resolves `台北` to Taipei and mock forecast returns success. | [mock] pending |
| 9.2 `臺北現在天氣如何？` | Mock geocoding resolves `臺北` to Taipei and mock forecast returns success. | [mock] pending |
| 9.3 `高雄鳳山今天會下雨嗎？` | Mock geocoding resolves `高雄鳳山` to Fengshan and mock forecast returns success. | [mock] pending |
| 9.4 `北京市現在幾度？` | Mock geocoding resolves `北京市` to Beijing and mock forecast returns success. | [mock] pending |
| 9.5 `新加坡現在的濕度？` | Mock geocoding resolves `新加坡` to Singapore and mock forecast returns success. | [mock] pending |
| 9.6 `Tokyo weather now` | Mock geocoding resolves Tokyo and mock forecast returns success. | [mock] pending |
| 9.7 `São Paulo weather` | Mock geocoding resolves the Unicode accented location and mock forecast returns success. | [mock] pending |
| 9.8 `München weather` | Mock geocoding resolves the Unicode umlaut location and mock forecast returns success. | [mock] pending |
| 9.9 `Springfield weather` | Mock geocoding returns multiple Springfield candidates and asserts `needs_clarification`. | [mock] pending |
| 9.10 `中山現在天氣如何？` | Mock geocoding returns multiple Zhongshan candidates and asserts `needs_clarification`. | [mock] pending |
| 9.11 Unknown location | Mock geocoding returns no candidates and asserts `not_found` without coordinates. | [mock] pending |
| 9.12 Geocoding provider failure | Mock geocoding failure asserts provider error, not `not_found`. | [mock] pending |
| 9.13 Forecast provider failure | Mock forecast failure asserts terminal weather error. | [mock] pending |
| 9.14 User cancellation / frontend loading | Mock cancelled WeatherToolResult renders as terminal error and does not show waiting/running fallback. | [mock] pending |
| 9.15 Sensitive data display | Mock error result with sensitive `message` verifies UI only renders safe summary. | [mock] pending |

## Boundary

The mock smoke tests verify deterministic tool/runtime/frontend contracts. They do not prove the real Gemini planner will extract the same locations from natural-language prompts, and they do not prove real Open-Meteo availability or live browser stream cancellation behavior.
