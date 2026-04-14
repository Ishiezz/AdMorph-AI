# AdMorph-AI
### A Landing Page Personalizer
 
AdMorph AI is a real-time personalization engine that aligns landing page messaging with ad intent to improve conversion rates without modifying the underlying website.
 
---
 
## What It Does
 
When users click an ad and land on a generic homepage, conversion drops. This tool fixes that by:
 
1. **Reading the ad** — Uses Claude Vision AI to extract offer, audience, tone, CTA, and urgency
2. **Scraping the landing page** — Extracts existing H1, H2, CTA, and body copy
3. **Generating personalized copy** — Rewrites only headline, subheadline, CTA, and hero copy to match the ad
4. **Showing a before/after diff** — Clear comparison of what changed and why
 
> The page layout, structure, navigation, and brand identity remain unchanged — only the messaging is intelligently optimized to align with the ad.
 
---
 
## System Flow
 
```
User Input
├── Ad Creative (image upload or URL)
└── Landing Page URL
         │
         ▼
┌─────────────────────────┐
│   Ad Analysis Agent     │  ← Claude Vision (GPT-4o class)
│   Extracts: offer,      │    temperature=0 for consistency
│   audience, tone, CTA   │
└────────────┬────────────┘
             │
┌─────────────────────────┐
│   Page Scraper          │  ← Cheerio + Axios
│   Extracts: H1, H2,     │    Fallback: manual paste
│   CTA buttons, body     │
└────────────┬────────────┘
             │
┌─────────────────────────┐
│   Personalization Agent │  ← Claude (low temperature)
│   Rewrites ONLY:        │    Strict prompt = no hallucination
│   headline, sub, CTA,   │    Whitelist of changeable fields
│   hero body copy        │
└────────────┬────────────┘
             │
┌─────────────────────────┐
│   Validation Layer      │  ← Hallucination guard
│   Flags invented         │    Checks numbers not in source
│   figures/claims        │
└────────────┬────────────┘
             │
         Output
    Before/After Diff
    + Rationale
    + Warnings (if any)
```
 
---
 
## Edge Case Handling
 
| Problem | Solution |
|---|---|
| **Broken UI / JS-heavy pages** | Cheerio scraper + fallback to manual copy paste |
| **Hallucinations** | Prompt instructs: "only use info from ad and page". Low temp (0.2). Number checker post-generation |
| **Inconsistent outputs** | `temperature: 0.2` + structured JSON schema response |
| **Random / out-of-scope changes** | Strict whitelist — only 4 fields can change. All else locked |
| **Scraping failures** | Returns `requiresManualInput: true` and asks user to paste |
 
---
 
## Tech Stack
 
| Layer | Tech |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (no framework needed) |
| Backend | Node.js + Express |
| AI Vision | Anthropic Claude (claude-opus-4-5) |
| Scraping | Axios + Cheerio |
| File Uploads | Multer |
| Deployment | Railway / Render / Vercel |
 
---
 
## Project Structure
 
```
AdMorph-AI/
├── backend/
│   ├── server.js          # Express API — all logic lives here
│   ├── package.json
│   └── .env.example       # Copy to .env, add your API key
├── frontend/
│   └── public/
│       └── index.html     # Complete frontend (single file)
├── .gitignore
└── README.md
```
 
---
 
## Setup & Run Locally
 
```bash
# 1. Clone the repo
git clone https://github.com/Ishiezz/AdMorph-AI.git
cd AdMorph-AI
 
# 2. Install backend deps
cd backend
npm install
 
# 3. Set up environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
 
# 4. Start the backend
npm run dev
# Runs on http://localhost:3001
 
# 5. Open the frontend
# Just open frontend/public/index.html in your browser
# Or serve it: npx serve frontend/public
```
 
---
 
## API Endpoint
 
### `POST /api/personalize`
 
**Form Data:**
| Field | Type | Required |
|---|---|---|
| `landingPageUrl` | string | Yes |
| `adImage` | file | One of these |
| `adImageUrl` | string | One of these |
 
**Response:**
```json
{
  "success": true,
  "adAnalysis": {
    "primaryOffer": "50% off for students",
    "targetAudience": "College students",
    "tone": "Fun, youthful",
    "ctaText": "Claim your discount",
    "urgency": "high"
  },
  "personalized": {
    "headline": "Students save 50% — today only",
    "subheadline": "The fastest way to get started, at a price made for you.",
    "ctaText": "Claim your discount",
    "heroBody": "Built for students who want more without paying full price.",
    "changeRationale": "Aligned headline with student offer from ad. Matched urgency.",
    "changesApplied": ["Headline updated", "CTA matched ad", "Urgency added"]
  },
  "diff": {
    "before": { "headline": "Welcome to Troopod", "ctaText": "Get Started" },
    "after":  { "headline": "Students save 50% — today only", "ctaText": "Claim your discount" }
  },
  "warnings": []
}
```
 
---

## Why This Improves Conversion

- Reduces cognitive dissonance between ad and landing page  
- Reinforces user intent immediately  
- Improves clarity and relevance  
- Increases trust by matching expectations set by the ad  
 
## What I'd Build Next (PM Roadmap)
 
- **A/B test integration** — Auto-generate 2-3 variants and split-test which converts best
- **Analytics overlay** — Show predicted CVR lift based on CRO principles applied
- **Multi-element support** — Personalize images, social proof, and FAQ sections
- **Batch mode** — Input 10 ad variants, get 10 personalized page variants instantly
- **Chrome extension** — Personalize any live page directly from the browser
 
---
 
## Assumptions Made
 
1. The landing page is publicly accessible (no login required)
2. The ad is image-based (not video)
3. The page uses standard HTML structure (H1, H2, CTAs)
4. "Personalization" means copy changes only — not layout, images, or brand elements
5. The user has an Anthropic API key
 
---
