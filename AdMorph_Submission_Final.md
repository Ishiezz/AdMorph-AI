# AdMorph AI
Ad-to-Landing-Page Personalization Engine

Troopod AI PM Internship Assignment
Submitted by: Isha Singh
GitHub: https://github.com/Ishiezz/AdMorph-AI

Live Demo: [https://admorph-ai-6d1v.onrender.com](https://admorph-ai-6d1v.onrender.com)

Demo Video: [https://drive.google.com/file/d/1PDDATBmu9gvZnXXK5C80a9YPiKWvzH-p/view?usp=sharing](https://drive.google.com/file/d/1PDDATBmu9gvZnXXK5C80a9YPiKWvzH-p/view?usp=sharing)

## Overview

AdMorph AI is a lightweight personalization workflow that takes:

1. an ad creative, via upload or image URL
2. a landing page URL

and returns a personalized version of the landing page messaging so the page better matches the ad the visitor clicked.

The product is intentionally non-destructive. It does not redesign the page or generate an entirely new website. Instead, it improves the highest-leverage copy areas of the existing page:

- headline
- subheadline
- CTA text
- meta description
- hero body copy

This keeps the output safer, easier to review, and more realistic for marketers who want message match without involving design or engineering for every ad variation.

## What The Demo Shows

In the live demo, the user can:

1. upload an ad image or paste a direct image URL
2. enter a landing page URL
3. generate a personalized output
4. compare the original and personalized page messaging side by side

The result is shown as a reconstructed preview of the original landing page hero and the personalized variant. This was a deliberate product decision for the prototype:

- many production sites are JavaScript-heavy and not reliably scrapeable with lightweight HTML parsing alone
- many real websites block iframe embedding
- a reconstructed preview still demonstrates the core value clearly: the existing page identity is preserved while the messaging becomes aligned to the ad

The system supports both uploaded images and public URLs; local hosting was used only for demonstration stability.

## How The System Works

The workflow runs in five stages:

### 1. Landing Page Extraction

The backend fetches the landing page and extracts:

- title
- H1
- H2
- CTA buttons
- meta description
- body copy

It also captures useful metadata like hostname, favicon, and page image to make the output preview feel closer to the original brand page.

### 2. Ad Understanding

The ad image is passed to Gemini, which extracts:

- main offer
- target audience
- tone
- urgency
- visible CTA
- ad headline

### 3. Copy Personalization

The structured ad analysis and scraped page content are sent back to Gemini with a constrained prompt that rewrites only the approved fields.

### 4. Validation

The output is checked for risky or invented claims, especially numbers and statistics not present in the source material.

### 5. Presentation

The frontend shows:

- what the AI inferred from the ad
- a before/after copy diff
- a visual original vs personalized landing page preview
- rationale for the changes

## Key Components / Agent Design

Frontend

- Vanilla HTML/CSS/JS
- simple upload + URL workflow
- clear before/after result presentation

Backend

- Node.js + Express
- Multer for file uploads
- Axios + Cheerio for extraction

AI Layer

- Gemini for multimodal ad understanding and structured copy generation
- low-temperature prompting for more stable, less creative outputs

Validation Layer

- post-generation scan for suspicious numbers or unsupported claims
- warnings surfaced directly in the UI

## How I Handle The Required Failure Modes

### Random Changes

The system is constrained to rewrite only five predefined fields. It does not modify navigation, layout, footer content, or visual design.

Why this matters:
This makes the product safe and reviewable. For marketers, a tool that improves message match without breaking the page is more valuable than a tool that rewrites everything.

### Broken UI

External pages are unpredictable. Some are JS-rendered, some are partially scrapeable, and many block direct embedding.

Current handling:

- scrape retries with timeout protection
- detection of low-content / JS-rendered pages
- graceful fallback instead of crashing
- reconstructed preview output rather than pretending to fully rewrite the live external DOM

Next improvement:
Use Playwright for richer extraction from modern React / Next.js pages.

### Hallucinations

The model is instructed not to invent prices, stats, or claims that are not present in the ad or page.

Current handling:

- strict prompt constraints
- low temperature generation
- post-generation scan for invented numbers
- visible warnings in the UI when something may need human review

### Inconsistent Outputs

To reduce variance across runs:

- the output format is constrained to structured JSON
- generation temperatures are kept low
- the response parser extracts only the relevant object
- the editable fields are tightly bounded

## Product Thinking Behind The Build

The most important product decision was restraint.

The AI is capable of generating far more text than the product should actually change. For this use case, trust matters more than maximal generation. A marketer should be able to look at the result and immediately understand:

- what changed
- why it changed
- what stayed the same
- whether it is safe to use

That is why the prototype focuses on:

- message match over full-page reinvention
- transparency over hidden generation
- constrained personalization over unconstrained “magic”

## Current Limitations

This prototype is intentionally scoped, so there are a few limits:

- JS-heavy pages are harder to extract reliably with simple scraping
- the app personalizes a reconstructed preview, not the literal live third-party DOM
- public image URLs are less reliable than file uploads
- free-tier model quotas can affect demo consistency

These are real product constraints, and I wanted to design around them honestly rather than hide them.

## What I Would Build Next

If I extended this beyond the assignment, my priorities would be:

1. Playwright support for JS-heavy pages
2. one-click publishing to CMS tools like Webflow or WordPress
3. multi-variant generation for A/B testing
4. post-personalization performance tracking to measure conversion lift

## Assumptions

- the landing page is publicly accessible
- the ad creative is image-based and readable
- the primary value is in improving the hero/message-match layer of the page
- the safest first product version is one that enhances the existing page instead of fully regenerating it

## Closing Note

The key insight from building this was that the hardest part is not generating new copy. It is generating enough trust around the output that someone would actually use it in a real workflow.

That is why I treated this as both an AI problem and a product design problem.

Thank you for the opportunity.

Isha Singh
