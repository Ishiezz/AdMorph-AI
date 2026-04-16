const express = require("express");
const cors    = require("cors");
const axios   = require("axios");
const cheerio = require("cheerio");
const multer  = require("multer");
const path    = require("path");

require("dotenv").config();

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*", methods: ["GET","POST"], allowedHeaders: ["Content-Type"] }));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "../frontend/public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODELS = (process.env.GEMINI_MODELS || "gemini-2.5-flash-lite,gemini-2.0-flash")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function isSupportedGeminiImageMimeType(mimeType = "") {
  return SUPPORTED_IMAGE_MIME_TYPES.has(String(mimeType).toLowerCase());
}

function getGeminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── HEALTH ──────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", gemini: GEMINI_KEY ? "configured" : "MISSING", models: GEMINI_MODELS });
});

// ── STRUCTURED ERROR ─────────────────────────────────────────────────────────
function sendError(res, status, errorType, message, retryable = false) {
  console.error(`[ERROR] ${errorType}: ${message}`);
  return res.status(status).json({ success: false, errorType, message, retryable });
}

function resolveAbsoluteUrl(baseUrl, candidate) {
  if (!candidate) return "";
  try {
    return new URL(candidate, baseUrl).href;
  } catch {
    return "";
  }
}

// ── SCRAPER ──────────────────────────────────────────────────────────────────
async function scrapeLandingPage(url, attempt = 1) {
  const MAX = 3;
  try { new URL(url); }
  catch { return { success: false, errorType: "INVALID_URL", message: "Invalid URL — must start with https://" }; }

  try {
    const parsedUrl = new URL(url);
    const { data } = await axios.get(url, {
      timeout: 20000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirects: 5,
      validateStatus: s => s < 400,
    });

    const $ = cheerio.load(data);
    const pageHostname = parsedUrl.hostname.replace(/^www\./, "");
    const pageTitle = $("title").text().trim().slice(0, 120) || "";
    const siteName = $('meta[property="og:site_name"]').attr("content")?.trim() || pageHostname;
    const faviconHref =
      $('link[rel="icon"]').attr("href") ||
      $('link[rel="shortcut icon"]').attr("href") ||
      $('link[rel="apple-touch-icon"]').attr("href") ||
      "/favicon.ico";
    const faviconUrl = resolveAbsoluteUrl(url, faviconHref);
    const ogImageUrl = resolveAbsoluteUrl(url, $('meta[property="og:image"]').attr("content")?.trim());
    const themeColor = $('meta[name="theme-color"]').attr("content")?.trim() || "";
    $("script, style, nav, footer, noscript, head, svg, iframe, [class*='cookie'], [class*='popup']").remove();

    const scraped = {
      title:           pageTitle,
      siteName,
      hostname:        pageHostname,
      faviconUrl,
      ogImageUrl,
      themeColor,
      h1:              $("h1").first().text().replace(/\s+/g," ").trim().slice(0, 200) || "",
      h2:              $("h2").first().text().replace(/\s+/g," ").trim().slice(0, 200) || "",
      metaDescription: $('meta[name="description"]').attr("content")?.trim() || "",
      ctaButtons:      [],
      bodyText:        $("body").text().replace(/\s+/g," ").trim().slice(0, 1500),
    };

    $(["button","a[href]",".cta",".btn","[class*='button']","[class*='cta']","[role='button']"].join(","))
      .each((i, el) => {
        if (scraped.ctaButtons.length >= 5) return false;
        const t = $(el).text().replace(/\s+/g," ").trim();
        if (t.length >= 2 && t.length <= 60) scraped.ctaButtons.push(t);
      });
    scraped.ctaButtons = [...new Set(scraped.ctaButtons)];

    console.log(`  Scraped → H1: "${scraped.h1 || "(empty)"}" | H2: "${scraped.h2 || "(empty)"}" | CTAs: [${scraped.ctaButtons.slice(0,2).join(", ")}]`);

    if (!scraped.h1 && !scraped.h2 && scraped.bodyText.length < 80) {
      return { success: false, jsRendered: true, errorType: "JS_RENDERED",
        message: "This page renders with JavaScript. Limited content was extracted." };
    }

    return { success: true, data: scraped };

  } catch (err) {
    const isTimeout = err.code === "ECONNABORTED" || err.message?.includes("timeout");
    const isNetwork = ["ENOTFOUND","ECONNREFUSED","ECONNRESET"].includes(err.code);

    if ((isTimeout || isNetwork) && attempt < MAX) {
      console.log(`  Scrape retry ${attempt}/${MAX}...`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return scrapeLandingPage(url, attempt + 1);
    }

    return {
      success: false,
      errorType: isTimeout ? "TIMEOUT" : "SCRAPE_FAIL",
      message: isTimeout ? "Page timed out. Try a simpler URL." : `Could not reach page: ${err.message}`,
    };
  }
}

//Json extractor
function extractJSON(raw, label) {
  if (!raw) throw new Error(`Empty response from Gemini (${label})`);
  let s = raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON found in Gemini ${label} response. Raw: ${s.slice(0,300)}`);
  s = s.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(s);
  } catch (parseErr) {
    throw new Error(`JSON parse failed for ${label}: ${parseErr.message}. Content: ${s.slice(0,200)}`);
  }
}


async function analyzeAdCreative(imageBase64, mimeType) {
  const prompt = `You are a digital marketing analyst. Analyze this advertisement image carefully.
Return ONLY a raw JSON object. No markdown. No code fences. No explanation before or after the JSON.

{
  "primaryOffer": "the main offer or value proposition shown in the ad",
  "targetAudience": "who this ad is specifically targeting",
  "tone": "emotional tone e.g. urgent, friendly, professional, playful",
  "ctaText": "the call-to-action text visible in the ad, or empty string if none",
  "keyBenefits": ["first key benefit", "second key benefit"],
  "visualTheme": "brief description of the visual style",
  "urgency": "high or medium or low",
  "adHeadline": "the main headline text visible in the ad, or empty string if unreadable"
}`;

const body = {
  contents: [{
    parts: [
      { text: prompt },
      {
        inline_data: {
          mime_type: mimeType,
          data: imageBase64
        }
      }
    ]
  }],
  generationConfig: { temperature: 0.1, maxOutputTokens: 700 },
};

  const res = await callGemini(body, "vision");

  const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const result = extractJSON(raw, "vision");
  console.log(`  Ad analysis → offer: "${result.primaryOffer}" | audience: "${result.targetAudience}" | urgency: ${result.urgency}`);
  return result;
}


async function generatePersonalizedCopy(adData, pageData) {
  const prompt = `You are a senior CRO (Conversion Rate Optimization) specialist.

Task: Personalize a landing page so its copy matches the ad the visitor clicked.
This is called "message match" — it reduces bounce rate and improves conversion.

AD CREATIVE DATA:
${JSON.stringify(adData, null, 2)}

CURRENT LANDING PAGE:
Title: ${pageData.title || "(not found)"}
H1 headline: ${pageData.h1 || "(not found)"}
H2 subheadline: ${pageData.h2 || "(not found)"}
CTA buttons: ${pageData.ctaButtons.join(", ") || "(not found)"}
Meta description: ${pageData.metaDescription || "(not found)"}
Body text excerpt: ${pageData.bodyText.slice(0, 700)}

RULES:
1. Only change: headline, subheadline, ctaText, metaDescription, heroBody
2. Do NOT invent numbers, prices, or stats not present in the ad or page
3. Match the ad's exact tone and target audience
4. ctaText: 2-6 words, starts with a verb
5. Preserve the brand voice from the original page

Return ONLY a raw JSON object. No markdown. No code fences. No preamble.

{
  "headline": "personalized H1 that matches ad offer",
  "subheadline": "personalized H2 that supports the headline",
  "ctaText": "personalized CTA button text",
  "metaDescription": "personalized meta description under 155 chars",
  "heroBody": "1-2 sentence hero section body copy",
  "changeRationale": "2-3 sentences explaining why these changes improve CVR",
  "changesApplied": ["what changed 1", "what changed 2", "what changed 3"]
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
  };

  const res = await callGemini(body, "text");

  const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const result = extractJSON(raw, "text");
  console.log(`  Generated → headline: "${result.headline}" | CTA: "${result.ctaText}"`);
  return result;
}

async function callGemini(body, label) {
  let lastErr;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`  Gemini ${label} → model: ${model} (attempt ${attempt}/3)`);
        return await axios.post(getGeminiUrl(model), body, {
          headers: { "Content-Type": "application/json" },
          timeout: 35000,
        });
      } catch (err) {
        lastErr = err;
        const parsed = parseGeminiError(err);
        const retryableRateLimit = parsed.errorType === "RATE_LIMIT" && attempt < 3;
        const retryableServerError = err.response?.status >= 500 && attempt < 3;

        if (retryableRateLimit || retryableServerError) {
          await sleep(1500 * attempt);
          continue;
        }

        if (parsed.errorType === "RATE_LIMIT") {
          console.warn(`  Gemini ${label} rate-limited on ${model}; trying next configured model if available.`);
          break;
        }

        throw err;
      }
    }
  }

  throw lastErr;
}

//Hallucination guard
function validateOutput(personalized, adData, pageData) {
  const warnings = [];
  const numRx = /\b\d+\s*%|\$\s*\d+|£\s*\d+|€\s*\d+|\b\d{2,}\s*(users|customers|reviews|days|hours)\b/gi;
  const output = [personalized.headline, personalized.subheadline, personalized.heroBody].join(" ");
  const source = JSON.stringify(adData) + " " + pageData.bodyText + " " + pageData.h1;
  (output.match(numRx) || []).forEach(num => {
    if (!source.includes(num.replace(/\D/g,"")))
      warnings.push(`Verify: "${num.trim()}" — may not appear in source material`);
  });
  return warnings;
}

// gemini error parser
function parseGeminiError(err) {
  const status = err.response?.status;
  const msg    = err.response?.data?.error?.message || err.message;
  const lowerMsg = msg?.toLowerCase() || "";

  if (status === 429 || msg?.includes("429") || lowerMsg.includes("quota"))
    return {
      errorType: "RATE_LIMIT",
      message: "Gemini quota is exhausted for this project or model right now. Wait for quota reset, enable billing, or switch to a higher-quota model.",
      retryable: true
    };
  if (status === 409 || msg?.includes("409"))
    return {
      errorType: "RATE_LIMIT",
      message: "Gemini is temporarily rate-limiting this project. Please retry shortly or switch models.",
      retryable: true
    };
  if (err.code === "ECONNABORTED" || msg?.includes("timeout"))
    return { errorType: "TIMEOUT", message: "The request took too long. Try again with a simpler page or image.", retryable: true };
  if (status === 400) {
    if (
      lowerMsg.includes("image") ||
      lowerMsg.includes("process this input") ||
      lowerMsg.includes("provided image is not valid")
    ) {
      return {
        errorType: "BAD_IMAGE",
        message: "We couldn’t read this image. Use a direct PNG, JPEG, WEBP, HEIC, or HEIF image URL, or upload the file instead.",
        retryable: false
      };
    }
  
    return {
      errorType: "API_ERROR",
      message: "Invalid request. Try a different input or check the image URL.",
      retryable: false
    };
  }
  if (status === 403)
    return { errorType: "API_ERROR", message: "API key is invalid or expired. Check your GEMINI_API_KEY.", retryable: false };

  return { errorType: "API_ERROR", message: "The AI service had an issue. Please try again.", retryable: true };
}


app.post("/api/personalize", upload.single("adImage"), async (req, res) => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    const { landingPageUrl, adImageUrl } = req.body;

    if (!landingPageUrl?.trim())
      return sendError(res, 400, "MISSING_URL", "Landing page URL is required.");
    if (!req.file && !adImageUrl?.trim())
      return sendError(res, 400, "MISSING_AD", "Please upload an ad image or paste an image URL.");
    if (!GEMINI_KEY)
      return sendError(res, 500, "NO_API_KEY", "GEMINI_API_KEY is not set. Add it to backend/.env and restart.");

    // Step1=Scrape
    console.log(`[1] Scraping: ${landingPageUrl}`);
    const scrapeResult = await scrapeLandingPage(landingPageUrl.trim());

    let pageData;
    let scrapeWarning = null;

    if (!scrapeResult.success) {
      if (scrapeResult.jsRendered) {
        console.log("  → JS-rendered page, using empty fallback");
        scrapeWarning = scrapeResult.message;
        const fallbackUrl = new URL(landingPageUrl);
        pageData = {
          title: fallbackUrl.hostname,
          siteName: fallbackUrl.hostname.replace(/^www\./, ""),
          hostname: fallbackUrl.hostname.replace(/^www\./, ""),
          faviconUrl: resolveAbsoluteUrl(landingPageUrl, "/favicon.ico"),
          ogImageUrl: "",
          themeColor: "",
          h1:"",
          h2:"",
          metaDescription:"",
          ctaButtons:[],
          bodyText:""
        };
      } else {
        return sendError(res, 422, scrapeResult.errorType || "SCRAPE_FAIL", scrapeResult.message, true);
      }
    } else {
      pageData = scrapeResult.data;
    }

    // Step2= image
    let imageBase64, mimeType;
    if (req.file) {
      imageBase64 = req.file.buffer.toString("base64");
      mimeType    = req.file.mimetype;
      if (!isSupportedGeminiImageMimeType(mimeType))
        return sendError(res, 400, "BAD_IMAGE", `Unsupported uploaded image format: ${mimeType}. Use PNG, JPEG, WEBP, HEIC, or HEIF.`, false);
      console.log(`[2] Upload: ${req.file.originalname} (${mimeType}, ${Math.round(req.file.size/1024)}KB)`);
    } else {
      console.log(`[2] Fetching image URL: ${adImageUrl}`);
      try {
        const imgRes = await axios.get(adImageUrl.trim(), {
          responseType: "arraybuffer", timeout: 15000,
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        mimeType = imgRes.headers["content-type"]?.split(";")[0] || "image/jpeg";
        if (!mimeType.startsWith("image/"))
          return sendError(res, 400, "NOT_AN_IMAGE", "That URL doesn't point to an image file. Paste a direct .jpg or .png link, or upload the image instead.");
        if (!isSupportedGeminiImageMimeType(mimeType))
          return sendError(res, 400, "BAD_IMAGE", `Unsupported image URL format: ${mimeType}. Use a direct PNG, JPEG, WEBP, HEIC, or HEIF image URL, or upload the file instead.`, false);
        imageBase64 = Buffer.from(imgRes.data).toString("base64");
        console.log(`  → Got image (${mimeType}, ${Math.round(imgRes.data.byteLength/1024)}KB)`);
      } catch (imgErr) {
        const geminiErr = parseGeminiError(imgErr);
        return sendError(res, 400, "IMAGE_FETCH_FAILED", `Could not download the ad image: ${imgErr.message}. Try uploading the file directly instead.`);
      }
    }

    // Step3= gemini version
    console.log("[3] Analyzing ad with Gemini Vision...");
    let adData;
    try {
      adData = await analyzeAdCreative(imageBase64, mimeType);
    } catch (err) {
      const parsed = parseGeminiError(err);
      return sendError(res, 502, parsed.errorType, `Ad analysis: ${parsed.message}`, parsed.retryable);
    }

    // Step4= gemini text
    console.log("[4] Generating personalized copy...");
    let personalized;
    try {
      personalized = await generatePersonalizedCopy(adData, pageData);
    } catch (err) {
      const parsed = parseGeminiError(err);
      return sendError(res, 502, parsed.errorType, `Copy generation: ${parsed.message}`, parsed.retryable);
    }

    // Step5= validate + build diff
    const warnings = validateOutput(personalized, adData, pageData);
    const diff = {
      before: {
        headline:        pageData.h1        || "",
        subheadline:     pageData.h2        || "",
        ctaText:         pageData.ctaButtons[0] || "",
        metaDescription: pageData.metaDescription || "",
      },
      after: {
        headline:        personalized.headline        || "",
        subheadline:     personalized.subheadline     || "",
        ctaText:         personalized.ctaText         || "",
        metaDescription: personalized.metaDescription || "",
      },
    };

    console.log("[5] ✓ Done");
    console.log("  DIFF BEFORE:", JSON.stringify(diff.before));
    console.log("  DIFF AFTER:", JSON.stringify(diff.after));
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    res.json({
      success:     true,
      adAnalysis:  adData,
      pageContext: {
        url:             landingPageUrl.trim(),
        title:           pageData.title || "",
        siteName:        pageData.siteName || "",
        hostname:        pageData.hostname || "",
        faviconUrl:      pageData.faviconUrl || "",
        ogImageUrl:      pageData.ogImageUrl || "",
        themeColor:      pageData.themeColor || "",
        h1:              pageData.h1 || "",
        h2:              pageData.h2 || "",
        metaDescription: pageData.metaDescription || "",
        ctaButtons:      pageData.ctaButtons || [],
      },
      personalized,
      diff,
      warnings,
      scrapeNote:  scrapeWarning,
    });

  } catch (err) {
    console.error("[UNHANDLED]", err.message);
    const parsed = parseGeminiError(err);
    sendError(res, 500, parsed.errorType, parsed.message, parsed.retryable);
  }
});

app.listen(PORT, () => {
  console.log(`
  ╭─────────────────────────────────────────╮
  │  AdMorph AI — server running            │
  │  http://localhost:${PORT}                   │
  │  Gemini: ${GEMINI_KEY ? "✓ configured" : "✗ KEY MISSING"}                 │
  │  Health: /api/health                    │
  ╰─────────────────────────────────────────╯
  `);
});
