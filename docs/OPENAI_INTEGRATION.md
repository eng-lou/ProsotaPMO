# OpenAI connection — 4 October 2026

Implemented locally; production activation and live API verification are pending
the user's OpenAI billing/project setup and server-side secret. No real OpenAI
requests were made during development. This supersedes the paused migration draft.

## Provider routing

| Feature | With OPENAI_API_KEY and default auto routing | Without the key |
| --- | --- | --- |
| Poe | GPT-6 Astra via Responses | Existing Anthropic service |
| AI Concept Render | GPT Image 2.5 Sunburst image editing | Existing Gemini service |

Once OpenAI is selected, failures are reported rather than silently sending the
request to a second provider. Poe's tools, approval cards, daily message quota,
project conversation persistence and attachment storage remain in place. API
keys stay on the backend. Draft changes are not deployed automatically.

## Activation

1. Sign in at https://platform.openai.com/ and create a Prosota project.
2. Complete API billing setup. The user enters payment details and authorizes
   purchases; don't collect these details in chat.
3. Create a project API key and store it securely, never in source control/chat.
4. Add `OPENAI_API_KEY` to the Vercel `prosota-pmo` project's Production environment
   as a server-only variable, with no `VITE_` prefix. Follow the deployment's
   backend/service scoping if Vercel presents that option.
5. Deploy the integration after authorization. Check account access to both
   model IDs; GPT Image access may require organization verification.
6. Run one synthetic Poe question, one read-only project tool request, one
   proposal that remains unapproved, and one synthetic concept image. Check
   the API usage dashboard and saved-history reload. This is paid API usage.

Do not claim a live connection until these checks succeed. Local mocked tests
cannot establish account access, image quality, billed usage or real latency.

## Optional backend variables

```text
AI_PROVIDER=auto
AI_CONCEPT_RENDER_PROVIDER=auto
OPENAI_CHAT_MODEL=gpt-6-astra
OPENAI_REASONING_EFFORT=high
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

`AI_PROVIDER=openai` / `AI_CONCEPT_RENDER_PROVIDER=openai` explicitly require
OpenAI and report a configuration error if its key is missing. For rollback,
set `AI_PROVIDER=anthropic` and `AI_CONCEPT_RENDER_PROVIDER=gemini`, retain the
corresponding old keys and redeploy. Existing conversation text/tool results can
be translated back; provider-specific internal reasoning is not portable.

## Contracts and practical limits

The adapter translates legacy text, image/PDF attachments, tool calls/results
and new Responses items while retaining the frontend's existing message shape.
OpenAI reasoning/output items are saved for exact replay alongside visible
text/tool mirrors. Mirrors are not sent twice. Privileged message roles are
rejected inside replay envelopes. Truncated function calls are never executed.
`store=false` is set; this does not remove Prosota's own saved conversations or
constitute a promise of zero provider data retention.

Concept rendering sends the captured PNG plus the fixed composition/material
instructions to Images edits. It requests one high-quality PNG with automatic
output dimensions. Exact source resolution and geometry are not guaranteed.
Faithful Upscale and the optional follow-up upscale have been removed entirely,
including their routes, services and fal-client dependency. The render UI contains
Off/Render, a prompt box and a 0-1 creativity slider (default 0.2). Retired saved
Faithful preferences migrate to Off to avoid unexpectedly making generative calls.
Creativity is validated server-side and mapped to graded prompt instructions:
0 prioritizes close source alignment, 0.5 balances realistic presentation and
alignment, and 1 allows adventurous materials, lighting and atmosphere while
preserving architecture and camera. It is not a provider temperature or an exact
geometry guarantee. Every generated result retains the AI-generated label.

Poe's browser request timeout is 240 seconds; concept rendering's is 300 seconds.
OpenAI calls use 120-second chat and 240-second image timeouts. Verify Vercel's
effective function duration for the deployed plan. Long tool loops or image generation can still exceed the total available request time. No automatic
retries are added to potentially chargeable requests.

The existing 30-message per-user daily quota is NOT a dollar spending cap;
superusers bypass it, each message can involve multiple model calls, and image
generation is separate. A persistent app-wide spending cap remains future work.
Begin with a small test balance and automatic top-ups disabled until actual
usage is understood. Provider dashboard budgets may be alerts, not hard stops.

## Verification

Run from backend using its installed Python environment:

```text
python -m unittest tests.test_openai_integration -v
```

Tests cover legacy conversations, image/PDF input, exact tool/reasoning replay,
privileged-role rejection, incomplete output, tools/schema mapping, server-tool
continuation, proposals waiting for approval, provider routing/rollback, concept
image requests, malformed image results, missing keys and sanitized errors.
All use mocks; no API key or paid request is required. Frontend validation:
`npm run build` from frontend.

## Prices checked 4 October 2026

Standard short-context Astra: USD $10/million input tokens and $50/million
output tokens; cached input $1/million, cache writes $12.50/million. Example:
5,000 ordinary input + 2,000 billed output tokens = $0.15 before other charges.
This is an illustration, not measured Prosota usage. Billed output includes
reasoning, and a single Poe message can require several calls.

GPT Image 2.5: $8/million image input tokens, $30/million image output tokens,
$5/million text input tokens. Hypothetical 10,000 image output tokens = $0.30
before input charges. Use the official calculator and actual API usage to
price chosen resolution/quality; do not treat this example as a per-image quote.

Sources (recheck when changing models or budgeting):
- https://developers.openai.com/api/docs/quickstart
- https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/file-inputs
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/pricing
