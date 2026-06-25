## ADDED Requirements

### Requirement: Weather Golden Eval Matrix MUST Cover Current Weather Capability Boundaries

The weather golden eval matrix MUST define reproducible cases for supported current-observation behavior and unsupported future capabilities without requiring Phase 1 to change runtime behavior.

#### Scenario: Current observation cases are represented
- **WHEN** the matrix is reviewed
- **THEN** it MUST include current temperature and current precipitation-observation cases
- **AND** it MUST include CJK, English, Unicode, and mixed-language location forms

#### Scenario: Forecast-like cases are represented as current gaps
- **WHEN** the matrix includes tomorrow, tonight, weekend, next-week, or advice-style weather questions
- **THEN** those cases MUST be classified as forecast-like or advice-like capability gaps unless the current runtime already has a formal forecast capability
- **AND** Phase 1 MUST NOT require those cases to pass as forecast answers

#### Scenario: Multi-turn clarification cases are represented as current gaps
- **WHEN** the matrix includes ambiguous-location follow-up prompts such as choosing a numbered candidate or replying with a country/region
- **THEN** those cases MUST be classified as multi-turn clarification gaps unless the current runtime already has a formal continuation contract
- **AND** Phase 1 MUST NOT require implementation of follow-up selection

### Requirement: Weather Golden Eval Matrix MUST Include Location Diversity

The matrix MUST include representative location forms that exercise provider-backed resolution without introducing runtime city mappings.

#### Scenario: CJK and Chinese variants are covered
- **WHEN** the matrix is reviewed
- **THEN** it MUST include Traditional Chinese, Simplified Chinese, administrative-region, and mixed Chinese-Latin examples
- **AND** equivalent variants such as common Traditional Chinese spellings MUST be compared for compatible outcomes

#### Scenario: English and Unicode variants are covered
- **WHEN** the matrix is reviewed
- **THEN** it MUST include English place names and Unicode place names with diacritics
- **AND** the expected outcome MUST be based on structured resolver/provider status rather than display text

#### Scenario: Ambiguous and missing locations are covered
- **WHEN** the matrix is reviewed
- **THEN** it MUST include ambiguous same-name locations and prompts with no usable location
- **AND** expected outcomes MUST distinguish clarification-needed behavior from not-found behavior

### Requirement: Weather Golden Eval Matrix MUST Include Failure, Timeout, And Cancellation Coverage

The matrix MUST define cases for provider failures, invalid inputs, timeouts, and cancellations.

#### Scenario: Provider failure is distinct from not found
- **WHEN** a provider error case is evaluated
- **THEN** the expected outcome MUST preserve provider-error semantics
- **AND** it MUST NOT be accepted as a not-found result

#### Scenario: Timeout is distinct from generic error
- **WHEN** a timeout case is evaluated
- **THEN** the expected outcome MUST preserve timeout semantics
- **AND** terminal behavior MUST NOT return to running

#### Scenario: Cancellation is distinct from timeout
- **WHEN** a cancellation case is evaluated
- **THEN** the expected outcome MUST preserve cancellation semantics
- **AND** terminal behavior MUST NOT be counted as a successful weather answer

### Requirement: Weather Golden Eval Expected Outcomes MUST Be Structured

Each eval case MUST declare structured expected outcome fields so the baseline does not depend on natural-language answer text.

#### Scenario: Expected outcome has stable fields
- **WHEN** an eval case is defined
- **THEN** it MUST include stable identifiers for case id, input, mode, capability category, expected status, and expected error or gap classification when applicable
- **AND** it MUST avoid using user-facing display text as the primary assertion source

#### Scenario: Unknown fields remain compatible
- **WHEN** future phases add extra observed outcome fields
- **THEN** the matrix comparison MUST ignore unknown fields unless a case explicitly asserts them
- **AND** existing Phase 1 cases MUST remain usable

### Requirement: Baseline Report MUST Record Pass, Fail, Known Gap, And Skipped Outcomes

The baseline report MUST honestly record observed outcomes and distinguish implementation failures from known current capability gaps.

#### Scenario: Passing current capability is reported
- **WHEN** a supported current-observation case meets its structured expected outcome
- **THEN** the baseline report MUST mark it as pass
- **AND** it MUST include enough structured summary to diagnose regressions later

#### Scenario: Known forecast gap is reported
- **WHEN** a forecast-like case is observed to fall back to current-observation behavior or an unsupported-capability response
- **THEN** the baseline report MUST mark it as known gap rather than hiding it
- **AND** it MUST identify Phase 2 as the owning future change

#### Scenario: Known clarification gap is reported
- **WHEN** a multi-turn clarification case cannot continue from prior candidates
- **THEN** the baseline report MUST mark it as known gap rather than hiding it
- **AND** it MUST identify Phase 3 as the owning future change

#### Scenario: Live smoke case is skipped
- **WHEN** live smoke is not explicitly enabled
- **THEN** the baseline report MUST mark live-only cases as skipped
- **AND** skipped live cases MUST NOT fail default CI
