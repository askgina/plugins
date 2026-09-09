# Ask Gina evaluation language

Terms used to plan evaluation coverage for Ask Gina's dedicated venue connections. Contract/safety checks and agent task trials are separate evidence layers.

## Language

**Venue MCP**:
A dedicated Spot, Perps or Predictions MCP connection, including that connection's documented read and write capabilities.
_Avoid_: Gina Read, venue plugin

**Gina Read**:
The combined read-only MCP connection for research and account visibility across venues. It is distinct from the three dedicated venue MCPs.
_Avoid_: Venue MCP, trading connection

**Contract/safety check**:
An evaluation of a declared MCP or venue-workflow invariant against controlled evidence, including permitted and prohibited actions.
_Avoid_: Agent task trial, model benchmark

**Agent task trial**:
An evaluation of how an identified model or native agent handles a natural-language user goal through a specified MCP connection and account-state context.
_Avoid_: Contract check, trading-performance result

**Venue workflow**:
A user goal spanning one or more venue capabilities, such as research, account inspection, preparation, execution or automation. Including a write workflow in evaluation scope is not authorization to perform it.
_Avoid_: Tool call, transaction approval

**Evaluation layer**:
One separately interpreted class of evidence: deterministic contract/safety checks or natural-language agent task trials. Passing one layer does not establish a pass in the other.
_Avoid_: Combined score, interchangeable proof
