Feature: IT Asset Tracker
  Traces docs/blueprints/asset-tracker.md stories US1–US4 (V2-210 pilot).
  Executed by playwright-bdd once adopted (ADR-058); coverage machine-verified now by
  `npm run bdd-coverage` (every USn maps to a scenario; a step with no definition reds).

  @US1
  Scenario: an editor creates and lists an asset
    Given an editor session
    When they create an asset with tag "LAP-001"
    Then the asset is persisted and audited
    And the asset appears in the paginated list

  @US2
  Scenario: a viewer cannot write to the register
    Given a viewer session
    When they attempt to create an asset
    Then the request is rejected with 403
    And no asset is written

  @US3
  Scenario: invalid input is rejected with the zod message
    Given an editor session
    When they create an asset with a blank tag
    Then the request is rejected with the validation message
    And no server error occurs

  @US4
  Scenario: an illegal status transition is rejected
    Given an asset in status "RETIRED"
    When an editor sets its status to "ASSIGNED"
    Then the request is rejected as an illegal transition
