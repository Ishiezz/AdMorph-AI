# AdMorph AI

AdMorph AI is an ad-to-landing-page personalization engine that improves message match between an ad creative and the page a user lands on.

Demo Video: [https://drive.google.com/file/d/1PDDATBmu9gvZnXXK5C80a9YPiKWvzH-p/view?usp=sharing](https://drive.google.com/file/d/1PDDATBmu9gvZnXXK5C80a9YPiKWvzH-p/view?usp=sharing)

The system takes:

1. an ad creative, via upload or direct image URL
2. a landing page URL

and returns a personalized version of the page messaging while preserving the original page identity.

## What It Does

AdMorph AI is intentionally non-destructive. It does not redesign the page or generate a brand new website. Instead, it updates only the highest-leverage copy fields:

- headline
- subheadline
- CTA text
- meta description
- hero body copy

The result is shown as:

- structured ad insights
- a before/after diff
- a reconstructed original vs personalized landing-page hero preview
- rationale and warnings when needed

## How It Works

The system runs in five stages:

1. Scrape the landing page using Axios and Cheerio
2. Analyze the ad creative with Gemini
3. Generate personalized copy from the combined ad + page context
4. Validate the output for suspicious invented claims
5. Present the result as a reviewable before/after experience

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML/CSS/JS |
| Backend | Node.js + Express |
| Scraping | Axios + Cheerio |
| Uploads | Multer |
| AI | Gemini |

## Product Principles

- Non-destructive personalization: preserve the page shell, improve the message
- Transparency: show what changed and why
- Trust: constrain the model to editable fields only
- Graceful degradation: handle scrape failures, image failures, and model issues without crashing the experience

## Edge Case Handling

### Hallucinations

- prompts explicitly forbid invented prices, stats, and unsupported claims
- a post-generation validator flags suspicious numbers not found in the source material

### Inconsistent Outputs

- low temperatures are used for more stable generation
- the output is requested in strict JSON format
- the parser extracts and validates only the structured object

### JS-Rendered Pages

- the scraper retries on timeouts and network failures
- low-content pages are flagged as JavaScript-rendered
- the app falls back gracefully instead of crashing

### Image Input Failures

- image URLs are validated by content type
- unsupported MIME types are rejected before the Gemini call
- uploads and public image URLs are both supported

## Running Locally

```bash
cd backend
npm install
npm start
```

Then open:

- `http://localhost:3001/`

You can also open `frontend/public/index.html` directly, since the frontend falls back to `http://localhost:3001` when loaded from `file://`.

## Environment

Create `backend/.env` with:

```bash
GEMINI_API_KEY=your_key_here
PORT=3001
```

Optional:

```bash
GEMINI_MODELS=gemini-2.5-flash-lite,gemini-2.0-flash
```

## API

### `POST /api/personalize`

Form fields:

- `landingPageUrl` required
- `adImage` optional file upload
- `adImageUrl` optional direct image URL

One of `adImage` or `adImageUrl` must be provided.

### `GET /api/health`

Returns basic status and configured Gemini models.

## Demo Note

The system supports both uploaded images and public URLs. For local demos, an image can also be served from `frontend/public/demo-assets/` for stability.
