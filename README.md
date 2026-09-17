<div align="center">
  <img src="assets/icon.png" alt="UniPost logo" width="112" />

  # UniPost

  **Create once. Publish everywhere.**

  A mobile-first workspace for composing, adapting, scheduling, publishing, and reviewing social content across multiple platforms.

  ![Expo](https://img.shields.io/badge/Expo-54-000020?style=flat-square&logo=expo&logoColor=white)
  ![React Native](https://img.shields.io/badge/React_Native-0.81-20232A?style=flat-square&logo=react&logoColor=61DAFB)
  ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
  ![Convex](https://img.shields.io/badge/Convex-Backend-EE342F?style=flat-square)
  ![License](https://img.shields.io/badge/License-MIT-22C55E?style=flat-square)
</div>

---

## Overview

UniPost turns one content idea into platform-aware drafts for Bluesky, LinkedIn, YouTube, Instagram, Pinterest, Facebook, and X. Every draft remains reviewable and editable before publishing. Users can publish immediately, schedule posts for later, or bypass generation and submit their own final copy unchanged.

The project combines an Expo and React Native client with a Convex backend, server-side integrations, deterministic writing-quality checks, publishing workflows, scheduling, and analytics.

## Highlights

- **Unified composer** — prepare one idea and adapt it for multiple destinations.
- **Human approval by default** — review and edit every platform draft before publishing.
- **Direct publishing or scheduling** — publish now or select platform-specific times.
- **Writing-quality guardrails** — identify repetitive, artificial, or low-quality phrasing without silently rewriting the user's work.
- **Account management** — connect and disconnect supported social accounts from one place.
- **Publishing history** — follow scheduled, published, and failed posts through a clear timeline.
- **Normalized analytics** — collect platform metrics into a consistent reporting model.
- **Server-side secrets** — keep API keys and account credentials outside the mobile bundle.

## Product Flow

```text
Idea or final copy
        │
        ▼
Platform selection ──► Platform-aware drafts
        │                       │
        │                       ▼
        └────────────────► Review and edit
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
               Publish now             Schedule
                    │                       │
                    └───────────┬───────────┘
                                ▼
                     History and analytics
```

## Technology

| Area | Technology |
| --- | --- |
| Mobile application | Expo, React Native, TypeScript |
| Backend and data | Convex |
| Social integrations | Bluesky AT Protocol and Composio-backed platform APIs |
| Content generation | OpenAI API |
| Media selection | Expo Image Picker |
| Scheduling | Convex scheduled functions |

## Project Structure

```text
UniPost/
├── assets/                 App icons and visual assets
├── convex/                 Schema, queries, mutations, jobs, and integrations
│   ├── lib/                Platform adapters and shared backend utilities
│   └── _generated/         Convex-generated API bindings
├── docs/                   Product specifications and integration guidance
├── gates/                  Feature-level validation records
├── src/
│   ├── components/         Shared interface components
│   ├── screens/            Product screens and workflows
│   ├── theme.ts            Design tokens and theme configuration
│   └── types.ts            Shared application types
├── App.tsx                 Application shell and navigation
├── app.json                Expo application configuration
└── index.ts                Application entry point
```

## Getting Started

### Prerequisites

- Node.js compatible with the installed Expo SDK
- npm
- A Convex account and project
- Platform credentials for the integrations you intend to enable

### Installation

```bash
git clone https://github.com/somewherelostt/UniPost.git
cd UniPost
npm install
```

Create the Convex development deployment and generate the local bindings:

```bash
npx convex dev --once
```

Start the Expo development server:

```bash
npm start
```

Use the platform scripts when needed:

```bash
npm run android
npm run ios
npm run web
```

## Environment Configuration

Set sensitive values in the Convex environment. Never place production secrets in Expo public variables or commit them to source control.

```bash
npx convex env set OPENAI_API_KEY your_openai_api_key
npx convex env set BLUESKY_HANDLE your_handle.bsky.social
npx convex env set BLUESKY_APP_PASSWORD your_app_password
npx convex env set COMPOSIO_API_KEY your_composio_api_key
```

Copy `.env.example` only as a reference for local configuration. Platform-specific setup details are documented in [`docs/composio-setup.md`](docs/composio-setup.md).

## Architecture

| Module | Responsibility |
| --- | --- |
| `convex/schema.ts` | Stores posts, platform variants, schedules, publishing state, and analytics data. |
| `convex/generatePost.ts` | Produces platform-aware drafts from a concise content brief. |
| `convex/checkSlop.ts` | Applies deterministic writing-quality rules and reports actionable findings. |
| `convex/publishPost.ts` | Routes approved content to the appropriate platform integration. |
| `convex/schedulePost.ts` | Coordinates delayed publishing and scheduled execution. |
| `convex/lib/bluesky.ts` | Implements Bluesky authentication and publishing through AT Protocol. |
| `convex/lib/composio.ts` | Coordinates supported third-party platform connections and publishing actions. |
| `src/screens/ComposeScreen.tsx` | Collects the brief, media, and destination platforms. |
| `src/screens/ReviewScreen.tsx` | Supports review, revision, approval, publishing, and scheduling. |
| `src/screens/HistoryScreen.tsx` | Presents chronological publishing activity and status. |
| `src/screens/AnalyticsScreen.tsx` | Displays normalized performance information. |
| `src/screens/AccountsScreen.tsx` | Manages platform connection state. |

## Security Principles

- Social-platform passwords are never collected by the mobile application.
- API keys and integration credentials remain in the server-side Convex environment.
- Bluesky uses a revocable app password instead of the primary account password.
- Third-party errors are normalized before they reach the interface.
- Publishing uses supported platform APIs rather than scraping or browser automation.
- Users review content before it is published or scheduled.

## Validation

Run the TypeScript compiler before submitting a change:

```bash
npx tsc --noEmit --pretty false
```

Feature validation notes and acceptance checks are recorded in [`GATES.md`](GATES.md) and the [`gates/`](gates/) directory.

## Documentation

- [`docs/spec-v0.md`](docs/spec-v0.md) — detailed initial product specification
- [`docs/spec-v1.md`](docs/spec-v1.md) — analytics and learning-system direction
- [`docs/spec-v1-postbridge-parity.md`](docs/spec-v1-postbridge-parity.md) — extended product parity research
- [`docs/composio-setup.md`](docs/composio-setup.md) — platform integration setup
- [`PLAN.md`](PLAN.md) — implementation plan and project history

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for details.

---

<div align="center">
  Built to make multi-platform publishing deliberate, consistent, and manageable.
</div>
