# Futurely — Design System

## Brand Identity
- **Product:** Futurely — AI-powered academic companion for high schoolers
- **Tone:** Confident, encouraging, clear. Not corporate. Not childish.
- **Users are teenagers** — UI must feel modern, fast, and trustworthy.

## Color Palette

### Brand Primaries
```
Primary Cyan:    #00E5FF  (electric cyan — accent, info)
Primary Blue:    #2979FF  (interactive — buttons, links, focus)
Primary Purple:  #7C3AED  (deep accent)
Accent Teal:     #00BCD4
Accent Lavender: #A855F7
```

### Semantic Tokens (mobile: colors.ts / web: CSS vars)
```
primary:        #2979FF   --primary
primaryDark:    #1B4DB0   --primary-dark
background:     #0D1829   --bg
surface:        #162235   --surface
surface2:       #1C2D47   --surface-2
border:         #273D5E   --border
borderHover:    #2F4970   --border-hover
textPrimary:    #E8EEFF   --text
textSecondary:  #96AACC   --text-secondary
textMuted:      #52698A   --text-muted
success:        #10B981
warning:        #F59E0B
error:          #EF4444
orange:         #F97316
info:           #00E5FF
purple:         #7C3AED
```

### Grade Colors
```
A: #10B981  (green)
B: #2979FF  (blue)
C: #F59E0B  (amber)
D: #F97316  (orange)
F: #EF4444  (red)
```

## Typography
- **Font:** System font stack (SF Pro on iOS, Roboto on Android via React Native defaults)
- **Web:** Inter (body) + Space Grotesk (display) via next/font
- **Scale:**
  - Display: 32px / weight 700
  - H1: 24px / weight 700
  - H2: 20px / weight 600
  - H3: 16px / weight 600
  - Body: 15px / weight 400 / line-height 1.6
  - Caption: 12px / weight 400
  - Label: 12px / weight 500 / uppercase + letter-spacing

## Logo & Brand Mark
- **FuturelyLogo** component (mobile: `nextstep-mobile/src/components/ui/FuturelyLogo.tsx`)
  - Rounded square, brand blue `#2979FF` bg, cyan `#00E5FF` accent stripe, white "F" glyph
  - Props: `size` (default 40) — scales all dimensions
  - No external package required (pure React Native View + Text)
- **Web SVG** (`public/logo.png`)
  - Mortarboard + book icon with brand gradient: `#00E5FF → #2979FF → #7C3AED`
  - Includes "Futurely" wordmark in the SVG
  - Used at 28×28 in sidebar, 48×48 on login page

## Spacing
- Base unit: 4px
- Common: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64
- Card padding: 16px
- Screen horizontal padding: 20px
- Section gap: 24px

## Components — Standards

### Cards
- Background: surface (`#162235`)
- Border: 1px solid border (`#273D5E`)
- Border-radius: 12px
- Shadow: none (flat design — dark theme)
- Padding: 16px

### Buttons
- Primary: bg `#2979FF`, text `#FFFFFF`, radius 8px, height 48px, weight 600
- Secondary: bg transparent, border `#1A2744`, text `#E8EEFF`
- Destructive: bg `#EF4444`, text white
- Disabled: opacity 0.4, no interaction
- Loading state: show spinner, disable interaction, preserve width
- Note: `expo-linear-gradient` not installed — use flat blue fallback

### Inputs
- Background: `#0D1829`
- Border: `#273D5E` (default), `#2979FF` (focused), `#EF4444` (error)
- Placeholder text: `#96AACC`
- Radius: 8px (web) / rounded-2xl (mobile)
- Height: 48px
- Label above input, error message below

### Navigation (mobile)
- Drawer sidebar: bg `#0D1829`, active item left-border `#2979FF`
- Active icon/label: `#2979FF`
- Inactive icon/label: `#96AACC`

### Navigation (web)
- Sidebar: bg `var(--surface)`, 220px expanded / 64px collapsed
- Active pill: `var(--primary-dim)` bg + `var(--primary-glow)` border
- Active icon: `var(--primary)` color

## Feature-Specific UI Standards

### Grade Viewer
- Subject cards with letter grade badge (large, colored by grade)
- GPA displayed prominently at top — large number, color-coded
- Trend indicator (↑↓→) with delta from last sync

### GPA Simulator
- Slider or input per class to adjust hypothetical grade
- Real-time GPA recalculation (debounced, no submit button)
- College readiness indicator: progress bar toward target GPA
- Visual diff: current vs projected (side-by-side or overlay)

### Smart Planner
- Calendar view (week default) + list view toggle
- Assignment cards: subject color coding, due date, estimated time, AI priority badge
- Overdue = red accent, due today = amber, upcoming = muted

### High School Roadmap
- Timeline visualization by grade (9th → 12th)
- Course completion badges
- Graduation progress: circular progress ring
- College prep checklist with checkable items

## Accessibility
- Minimum contrast ratio: 4.5:1 for body text, 3:1 for large text
- All interactive elements: minimum 44×44pt touch target
- All images: accessibility labels
- Support system font size scaling (no fixed font sizes in pixels)
- No color-only information conveying — always pair color with text/icon

## Animation
- Navigation transitions: 250ms ease-in-out
- Data loading: skeleton screens (not spinners for content)
- Micro-interactions: 150ms
- No animations that cannot be disabled (respect `prefers-reduced-motion`)

## Rules
- Dark theme is the default and primary design target
- No gradient backgrounds on content screens (only on marketing/onboarding)
- No lorem ipsum in any deliverable
- All screens must have empty states and error states designed
- Loading states required on every async action
- `react-native-svg` is now installed (mobile) — added for the "Continue with Google"
  button's real multi-color Google logo, since Google's brand guidelines require the
  actual logo, not a substitute. It's Expo Go-compatible (bundled support, no dev-client
  needed). Gradient card fills (`Card` component's `variant="gradient"`) also use
  `react-native-svg`'s `LinearGradient`/`Rect` rather than adding `expo-linear-gradient`
  as a second, redundant gradient dependency — don't install `expo-linear-gradient`
  without updating this doc.
- Mobile visual language was rebuilt against a Figma prototype reference
  (`https://cute-near-11852013.figma.site`, see `melodic-wobbling-pillow.md` plan) —
  dark near-black background (`#07080F`), violet/indigo gradient hero cards and quick-
  action tiles, hairline card borders instead of drop shadows, circular tint+border
  grade badges, pill-shaped segmented controls and urgency badges. `theme/tokens.ts`'s
  `colors`/`gradients` exports are the source of truth; update this doc if they drift.
