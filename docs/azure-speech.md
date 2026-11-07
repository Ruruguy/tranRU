# Azure Speech integration — 2026-11-07

Route: captured microphone/tab PCM → Azure Speech → final source transcript → selected Gemini/OpenAI text translator. The existing three-language layout, Traditional Chinese conversion, medical glossary, exports, summary and reconnect controller are reused. Gemini and OpenAI speech modes remain available. Conversation mode is unchanged.

Setup: use your own Azure **Speech** resource key and its region (not an Azure OpenAI endpoint/key). Select an explicit lecture language, set a Gemini/OpenAI translation key and choose that provider in settings. Keys are never embedded in the repository. Azure credentials exist only in the current page's memory and go directly to Microsoft via its SDK; the application backend never receives them. Reloading clears them. SDK telemetry is disabled.

SDK: microsoft-cognitiveservices-speech-sdk 1.53.0 from the official npm registry; tarball SHA-512 checked against registry metadata. Browser bundle and upstream license are vendored under public/vendor. No floating CDN dependency.

Behavior: locale zh-TW for Taiwan Mandarin; locale-specific Chinese/English/Japanese phrase hints from the existing medical glossary; replace interim hypotheses, translate final results once. Temporary network failures use the existing bounded reconnect buffer; authentication and quota failures stop. Scheduled reconnection preserves existing subtitle records. A gap notice indicates potentially missing audio; gap-free transcription is not promised. Source language auto-detection is rejected before audio capture in this mode.

Gemini accuracy: Google AI subscription benefits and external Gemini API billing are distinct. Cancelling a subscription is not evidence of a silent model downgrade in tranRU. Credits/access can affect availability; mode, selected model, recording quality and context should be controlled when comparing precision. Current Gemini direct live translation does not inject medical vocabulary; the precision and Azure routes do.

References:
- https://ai.google.dev/gemini-api/docs/google-ai-plans
- https://ai.google.dev/gemini-api/docs/billing
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-use-audio-input-streams
- https://learn.microsoft.com/en-us/javascript/api/microsoft-cognitiveservices-speech-sdk/phraselistgrammar

Self-review (this change was self-reviewed only):
1. Added the requested optional Azure route; kept Gemini and OpenAI. Addressed silent initialization with a visible bootstrap failure message and versioned static module URLs. The reported dead button did not reproduce on a fresh hosted page; no unsupported root-cause claim.
2. Automated tests cover Azure PCM/hints/events, sanitized auth errors, reconnection, stop and cancellation; existing translation and summary regressions run. Local and static pages were checked in a real browser. No real Azure credentials, microphone API session or long lecture quality evaluation was available.
3. Risks: additional Azure charge, finalized-sentence latency, unsupported resource/region or locale capabilities; not proven more accurate. Azure mode requires a separate text-translation key.
4. Local server routes, static build, settings, documentation and tests updated together. Original local port was not listening; restarted it. No change to conversation mode.
5. UI and README explain credential setup and data destinations; final response tells the user what remains unverified.

Next useful validation: compare a short identical medical lecture recording across Gemini live, Gemini precision and Azure, measuring term/numeral errors and latency. Worth doing when usable Azure credentials and a recording are supplied; no automatic model preference change before that evidence.
