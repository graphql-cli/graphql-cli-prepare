Feature: testfeature

    Scenario: First scenario
        Given I provide the following parameters
            | Parameter | Value |
            | bindings  | true  |
            | bundle    | true  |
        When I run the command
        Then it should work