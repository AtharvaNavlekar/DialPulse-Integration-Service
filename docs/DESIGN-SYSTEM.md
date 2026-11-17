# DialPulse Workspace — Design System Specification

**Source of Truth:** Official DialPulse Client CRM (`Client-CRM/src/index.css`) & DialPulse Central CRM (`DialPulse-Central-CRM/src/index.css`), implemented via CSS custom properties (`--dp-*`) in `/src/index.css`.

---

## 1. Brand Personality & Aesthetic Rules

- **Domain Tone:** Financial-services enterprise operations — clean, trustworthy, structured, high-clarity.
- **Anti-Slop Constraints:**
  - Zero decorative pulsing status dots next to titles or headings.
  - Zero static pill capsules around metadata (`category`, `date`, `count`); metadata uses plain unboxed text with `·` separators.
  - Zero thick asymmetric left accent borders (`border-l-4`) on cards.
  - Single-elevation surfaces (`1px` `--dp-outline-variant` borders; no nested cards inside cards).
  - WCAG AA contrast (minimum `4.5:1` for body text, `3:1` for large text/controls).
  - All numeric counts, IDs, currencies, and timestamps use `tabular-nums` (or `font-mono tabular-nums`).

---

## 2. Official Color Tokens

### Light Theme (`:root`, default)

| Token | Hex | Usage |
| --- | --- | --- |
| `--dp-primary` | `#00695C` | Primary CTA fills, active nav indicators, focus rings |
| `--dp-primary-hover` | `#00554A` | Primary button hover |
| `--dp-on-primary` | `#FFFFFF` | Text/icons on primary fill |
| `--dp-primary-container` | `#CCE8E1` | Active sidebar row background, subtle highlight tint |
| `--dp-on-primary-container` | `#00201B` | Text/icons inside primary container |
| `--dp-secondary` | `#4A635D` | Secondary accents and chart bars |
| `--dp-secondary-container` | `#CCE8E0` | Secondary surface accents |
| `--dp-background` | `#FFFFFF` | Sidebar, top bar, primary card surfaces |
| `--dp-surface` | `#F8FAF9` | Main application canvas |
| `--dp-surface-variant` | `#F1F5F4` | Hover surfaces, segmented control tracks |
| `--dp-on-surface` | `#0F172A` | Primary headings and body copy |
| `--dp-on-surface-variant` | `#475569` | Secondary labels, helper copy |
| `--dp-outline` | `#94A3B8` | Muted icons, placeholder text |
| `--dp-outline-variant` | `#E2E8F0` | Card borders, hairline table dividers |
| `--dp-navy` | `#1E293B` | High-contrast tooltips & dark neutral accents |
| `--dp-success` / `--dp-success-text` | `#10B981` / `#047857` | Success indicators (darker `#047857` for WCAG AA small text) |
| `--dp-warning` / `--dp-warning-text` | `#F59E0B` / `#B45309` | Warning indicators (darker `#B45309` for WCAG AA small text) |
| `--dp-error` | `#BA1A1A` | Destructive actions, validation errors |

### Dark Theme (`.dark` class on `<html>`)

| Token | Hex | Usage |
| --- | --- | --- |
| `--dp-primary` | `#80D5C4` | Primary action fill & interactive accents |
| `--dp-primary-hover` | `#9BE0D2` | Primary hover |
| `--dp-on-primary` | `#003830` | Text on primary button |
| `--dp-primary-container` | `#004F46` | Active sidebar row background |
| `--dp-on-primary-container` | `#A3F2E4` | Text on primary container |
| `--dp-background` | `#0B0F0E` | Sidebar & top header |
| `--dp-surface` | `#111514` | Main application canvas |
| `--dp-surface-variant` | `#1B2120` | Hover states & segmented tracks |
| `--dp-surface-container-lowest` | `#070A09` | Card backgrounds & inputs |
| `--dp-on-surface` | `#F1F5F9` | Primary headings & copy |
| `--dp-on-surface-variant` | `#94A3B8` | Secondary copy |
| `--dp-outline` | `#64748B` | Subtle placeholders & icons |
| `--dp-outline-variant` | `#334155` | Hairline borders & dividers |
| `--dp-success-text` | `#34D399` | WCAG AA green text on dark |
| `--dp-warning-text` | `#FBBF24` | WCAG AA amber text on dark |
| `--dp-error` | `#FFB4AB` | Error text & alerts on dark |

*(Configured with `@custom-variant dark (&:where(.dark, .dark *));` in `/src/index.css` plus a pre-paint theme script in `/index.html` using `dialpulse_workspace_theme`.)*

---

## 3. Typography & Radii

- **Display & Headings (`--font-heading`):** `'Plus Jakarta Sans'`, `text-wrap: balance`.
- **Body (`--font-body`):** `'Roboto'`, antialiased, `letter-spacing: 0.005em`.
- **Code, Slugs, IDs & Timestamps (`--font-mono`):** `'JetBrains Mono'`, paired with `tabular-nums`.
- **Border Radii:**
  - `--dp-radius-sm`: `8px` (buttons, inputs, sidebar items)
  - `--dp-radius-md`: `12px` (cards, popovers, dialogs)
  - `--dp-radius-lg`: `16px` (auth card, public form sheet)

---

## 4. Shared UI Primitives (`/src/components/ui/Primitives.tsx`)

| Primitive | Purpose |
| --- | --- |
| `PageHeader` | Standard top view heading (`h1`), description, and right-aligned action group |
| `Card` | Clean surface container (`--dp-surface-container-lowest`, `1px` `--dp-outline-variant`, `--dp-radius-md`) |
| `Button` | `primary`, `secondary`, `danger`, `ghost` variants (`sm` / `md`) with accessible focus rings |
| `SegmentedControl` | Functional tab/filter selector (`role="tablist"`, `whitespace-nowrap`) |
| `StatusIndicator` | Semantic text + icon/dot status indicator (never hue-only) |
| `AlertBanner` | Accessible inline error/warning/success/info feedback |
| `ConfirmModal` | Accessible confirmation dialog (`role="dialog"`, `aria-modal="true"`) replacing `window.confirm` |
| `ThemeToggleButton` | Persistent Light/Dark toggle |
| `DialPulseMark` | Official SVG geometric mark (`src/components/ui/DialPulseLogo.tsx` & `/public/favicon.svg`) |
