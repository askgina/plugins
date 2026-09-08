# Ask Gina evaluation language

These terms distinguish what an evaluation observes from what its results can claim.

## Language

**Model comparison**:
A comparison of models under a shared evaluator-controlled prompt and tool environment. It does not establish behavior inside an installed native agent.

**Native-agent comparison**:
A comparison of complete agent runtimes, including their instructions, tool policies, and plugin or skill discovery behavior. The agent and its model are separate parts of the evaluated configuration.

**Plugin activation evidence**:
An observation that the evaluated agent actually discovered or activated the installed Ask Gina plugin or skill. Supplying equivalent instructions directly is not activation evidence.

**Saved-login authentication**:
Model-service access through an existing supported agent login. It is distinct from provider API-key authentication and from authorization to call Gina MCP.

**Measured attempt**:
One observed execution of a case in a declared evaluation run. A preflight failure before execution is not a completed measured attempt.

**Retained attempt detail**:
The permitted per-attempt evidence bound to the exact saved aggregate report. Missing detail cannot be reconstructed from aggregate counts.
