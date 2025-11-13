# Sprint: Agent MaxSteps Feature

## Problem Statement
Users need the ability to limit the number of steps that agents (especially subagents) can take during execution, as outlined in [Issue #3631](https://github.com/sst/opencode/issues/3631). This feature will prevent runaway agent loops and give users better control over agent execution limits.

## Context
### Existing System
OpenCode has an agentic loop system controlled in `packages/opencode/src/session/prompt.ts`. Currently, agents can run indefinitely without any step limits, which can lead to:
- Excessive resource consumption
- Runaway loops in faulty agent logic
- Unpredictable costs when using paid APIs
- Difficulty in debugging agent behavior

### MaxSteps Feature Requirements
The maxSteps feature must:
- Allow optional step limits for agent definitions
- Work for both primary agents and subagents (primary use case is subagents)
- Stop execution when the limit is reached
- On the n-1 step, remove all tools from the request to force a text-only response
- Be configurable per agent definition
- Default to unlimited if not specified (backward compatibility)

## Success Criteria
- [ ] Agent definitions accept optional `maxSteps` parameter
- [ ] Step counter tracks execution steps accurately
- [ ] Agent stops at maxSteps limit
- [ ] On step n-1, tools are removed from the request
- [ ] Final step produces a text-only response summarizing status
- [ ] Feature works for both primary and subagents
- [ ] No breaking changes to existing agent definitions
- [ ] Step limit is logged for debugging purposes
- [ ] Clear error/status message when limit is reached
- [ ] Tests cover various step limit scenarios
- [ ] Documentation updated with maxSteps usage

## Technical Requirements

### Agent Definition Schema
```typescript
interface AgentDefinition {
  name: string;
  description: string;
  tools?: Tool[];
  maxSteps?: number; // New optional field
  // ... other existing fields
}
```

### Implementation Location
- Primary implementation in: `packages/opencode/src/session/prompt.ts`
- Agent definition types updated
- Step counter logic added to agentic loop

### Step Counting Logic
1. Initialize step counter when agent starts
2. Increment counter after each tool execution
3. Check if current step === maxSteps - 1
   - If true: Remove tools from next request
4. Check if current step === maxSteps
   - If true: Stop execution and return final response

### Edge Cases to Handle
- maxSteps = 0 (should be invalid)
- maxSteps = 1 (immediate text response)
- maxSteps = 2 (one tool call, then text)
- Nested subagent calls (each has own counter)
- Error handling when limit reached mid-operation

## Testing Strategy
1. Unit tests for step counter logic
2. Integration tests with mock agents
3. Test various maxSteps values (1, 2, 10, undefined)
4. Test tool removal on n-1 step
5. Test nested agent scenarios
6. Test error cases and boundary conditions
7. Performance tests to ensure no overhead when maxSteps not used

## Validation Checklist
- [ ] maxSteps parameter accepted in agent definitions
- [ ] Step counter increments correctly
- [ ] Execution stops at limit
- [ ] Tools removed on penultimate step
- [ ] Final response is text-only
- [ ] No regression in unlimited agents
- [ ] Logs show step count and limit
- [ ] Clear status message on limit reached
- [ ] Tests pass for all scenarios
- [ ] Documentation includes examples

## Example Usage
```typescript
const limitedAgent = {
  name: "limited-helper",
  description: "An agent with step limits",
  maxSteps: 5,  // Will stop after 5 steps
  tools: [/* ... tools ... */]
};

// On step 4, tools will be removed
// On step 5, execution stops with text response
```