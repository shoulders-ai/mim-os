---
id: models
title: models
generated: true
---

# models

Models available in Mim, grouped by provider. Pricing is per million tokens
(input/output).

## providers

| provider | api endpoint | key env var |
|---|---|---|
| anthropic | https://api.anthropic.com/v1/messages | `ANTHROPIC_API_KEY` |
| openai | https://api.openai.com/v1/responses | `OPENAI_API_KEY` |
| google | https://generativelanguage.googleapis.com/v1beta/models | `GOOGLE_API_KEY` |
| exa | https://api.exa.ai/search | `EXA_API_KEY` |

## defaults

| role | models |
|---|---|
| chat | `claude-sonnet-5`, `gemini-3.5-flash`, `gpt-5.4` |
| agent | `claude-sonnet-5`, `gemini-3.5-flash`, `gpt-5.4` |
| rewrite | `claude-sonnet-5`, `gemini-3.5-flash`, `gpt-5.4` |
| inline | `claude-sonnet-5`, `gemini-3.5-flash`, `gpt-5.4` |
| ghost | `claude-haiku-4-5-20251001`, `gemini-3.1-flash-lite`, `gpt-5.4-nano` |
| extract | `claude-haiku-4-5-20251001`, `gemini-3.1-flash-lite`, `gpt-5.4-nano` |

## anthropic

| model | context | pricing (in/out) | capabilities | control |
|---|---|---|---|---|
| Claude Fable 5 | 1M | $10/$50 | text, json, streaming, reasoning, tools, promptCaching, vision | effort (high) |
| Claude Opus 4.8 | 1M | $5/$25 | text, json, streaming, reasoning, tools, promptCaching, vision | effort (high) |
| Claude Sonnet 5 | 1M | $2/$10 | text, json, streaming, reasoning, tools, promptCaching, vision | effort (medium) |
| Claude Haiku 4.5 | 200K | $1/$5 | text, json, streaming, reasoning, tools, promptCaching, vision | thinking (none) |

## google

| model | context | pricing (in/out) | capabilities | control |
|---|---|---|---|---|
| Gemini 3.1 Pro | 1M | $2/$12 | text, json, streaming, reasoning, tools, promptCaching, vision | thinking (high) |
| Gemini 3.5 Flash | 1M | $1.5/$9 | text, json, streaming, reasoning, tools, promptCaching, vision | thinking (medium) |
| Gemini 3.1 Flash-Lite | 1M | $0.25/$1.5 | text, json, streaming, reasoning, tools, promptCaching, vision | thinking (minimal) |

## openai

| model | context | pricing (in/out) | capabilities | control |
|---|---|---|---|---|
| GPT-5.5 | 1M | $5/$30 | text, json, streaming, reasoning, tools, promptCaching, vision | effort (medium) |
| GPT-5.4 | 1M | $2.5/$15 | text, json, streaming, reasoning, tools, promptCaching, vision | effort (medium) |
| GPT-5.4 mini | 400K | $0.75/$4.5 | text, json, streaming, reasoning, tools, promptCaching, vision | effort (low) |
| GPT-5.4 nano | 200K | $0.2/$1.25 | text, json, streaming, reasoning, tools, promptCaching | effort (none) |
