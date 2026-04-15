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


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

// Health check 

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    gemini: GEMINI_KEY ? "configured" : "MISSING — add GEMINI_API_KEY to .env",
    node:   process.version,
  });
});


// scraper = retry logic, better headers, JS-page detection

async function scrapeLandingPage(url, attempt = 1) {
  const MAX = 3;

  
  try { new URL(url); }
  catch { return { success: false, error: "Invalid URL — make sure it starts with https://" }; }

  const headers = {
    "User-Agent":      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control":   "no-cache",
  };

  try {
    const { data } = await axios.get(url, {
      timeout: 20000,
      headers,
      maxRedirects: 5,
      validateStatus: s => s < 400,
    });

    const $ = cheerio.load(data);
    $("script, style, nav, footer, noscript, head, svg, iframe").remove();

    const scraped = {
      title:           $("title").text().trim().slice(0, 120) || "Untitled",
      h1:              $("h1").first().text().replace(/\s+/g," ").trim().slice(0, 200) || "",
      h2:              $("h2").first().text().replace(/\s+/g," ").trim().slice(0, 200) || "",
      metaDescription: $('meta[name="description"]').attr("content")?.trim() || "",
      ctaButtons:      [],
      bodyText:        $("body").text().replace(/\s+/g," ").trim().slice(0, 1500),
    };

    // broader CTA selector
    $(["button","a[href]",".cta",".btn","[class*='button']","[class*='cta']","[role='button']"].join(","))
      .each((i, el) => {
        if (scraped.ctaButtons.length >= 5) return false;
        const t = $(el).text().replace(/\s+/g," ").trim();
        if (t.length >= 2 && t.length <= 60) scraped.ctaButtons.push(t);
      });
    scraped.ctaButtons = [...new Set(scraped.ctaButtons)];

    // detect JS only pages(empty shell)
    if (!scraped.h1 && !scraped.h2 && scraped.bodyText.length < 80) {
      return { success: false, jsRendered: true,
        error: "This page is JavaScript-rendered (React/Next.js). The scraper got an empty shell." };
    }

    return { success: true, data: scraped };

  } catch (err) {
    const isTimeout = err.code === "ECONNABORTED" || err.message?.includes("timeout");
    const isNetwork = ["ENOTFOUND","ECONNREFUSED","ECONNRESET"].includes(err.code);

    if ((isTimeout || isNetwork) && attempt < MAX) {
      console.log(`  Retry ${attempt}/${MAX} for ${url}`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return scrapeLandingPage(url, attempt + 1);
    }

    return {
      success: false,
      error: isTimeout
        ? `Page timed out after ${MAX} attempts. Try a simpler URL.`
        : `Could not reach page: ${err.message}`,
    };
  }
}

function extractJSON(raw) {
  if (!raw) throw new Error("Empty response from Gemini");
  let s = raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`No JSON in Gemini response. Got: ${s.slice(0,200)}`);
  s = s.slice(start, end + 1);
  s = s.replace(/,\s*([}\]])/g, "$1"); 
  return JSON.parse(s);
}

// gemini vision = analyze ad creative

async function analyzeAdCreative(imageBase64, mimeType) {
  const prompt = `Analyze this advertisement image as a digital marketing expert.
Return ONLY a raw JSON object. No markdown. No explanation. No code fences.

{
  "primaryOffer": "the main offer or value proposition",
  "targetAudience": "who this ad targets",
  "tone": "emotional tone e.g. urgent, friendly, professional",
  "ctaText": "CTA text visible in the ad, or empty string",
  "keyBenefits": ["benefit1", "benefit2"],
  "visualTheme": "brief visual style description",
  "urgency": "high or medium or low",
  "adHeadline": "main headline text in the ad, or empty string"
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
  };

  const res = await axios.post(GEMINI_URL, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini Vision returned empty content");
  return extractJSON(raw);
}

//gemini text= generate personalized copy

async function generatePersonalizedCopy(adData, pageData) {
  const prompt = `You are a senior CRO specialist. Rewrite specific landing page copy to match an ad creative.
This is called message match — it reduces bounce rate and improves conversion.

AD CREATIVE:
${JSON.stringify(adData, null, 2)}

CURRENT LANDING PAGE:
- H1: ${pageData.h1 || "(none found)"}
- H2: ${pageData.h2 || "(none found)"}
- CTA buttons: ${pageData.ctaButtons.join(", ") || "(none found)"}
- Meta description: ${pageData.metaDescription || "(none found)"}
- Body excerpt: ${pageData.bodyText.slice(0, 600)}

STRICT RULES:
1. Modify ONLY: headline, subheadline, ctaText, metaDescription, heroBody
2. Do NOT invent prices, percentages, or stats not in the ad or page
3. Match the ad's tone and audience exactly
4. ctaText must be 2-6 words, action-oriented
5. Keep brand voice consistent with original page

Return ONLY a raw JSON object. No markdown. No code fences. No explanation.

{
  "headline": "new H1",
  "subheadline": "new H2",
  "ctaText": "new CTA",
  "metaDescription": "under 155 chars",
  "heroBody": "1-2 sentences",
  "changeRationale": "2-3 sentences explaining WHY these changes improve CVR",
  "changesApplied": ["change 1", "change 2", "change 3"]
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
  };

  const res = await axios.post(GEMINI_URL, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini text returned empty content");
  return extractJSON(raw);
}


//Hallucination guard
function validateOutput(personalized, adData, pageData) {
  const warnings = [];
  const numRx = /\b\d+\s*%|\$\s*\d+|£\s*\d+|€\s*\d+|\b\d{2,}\s*(users|customers|reviews|days|hours)\b/gi;
  const output = [personalized.headline, personalized.subheadline, personalized.heroBody].join(" ");
  const source = JSON.stringify(adData) + " " + pageData.bodyText + " " + pageData.h1;
  (output.match(numRx) || []).forEach(num => {
    if (!source.includes(num.replace(/\D/g,"")))
      warnings.push(`Verify: "${num.trim()}" — may not be in source material`);
  });
  return warnings;
}


function sendError(res, status, code, message, tip = null) {
  return res.status(status).json({ success: false, error: { code, message, tip } });
}


//Main endpoint

app.post("/api/personalize", upload.single("adImage"), async (req, res) => {
  try {
    const { landingPageUrl, adImageUrl } = req.body;

    if (!landingPageUrl?.trim())
      return sendError(res, 400, "MISSING_URL", "Landing page URL is required.");
    if (!req.file && !adImageUrl?.trim())
      return sendError(res, 400, "MISSING_AD", "Upload an ad image or paste an image URL.");
    if (!GEMINI_KEY)
      return sendError(res, 500, "NO_API_KEY", "GEMINI_API_KEY missing.", "Add it to backend/.env and restart.");

    // step1= Scrape
    console.log(`\n[1] Scraping: ${landingPageUrl}`);
    const scrapeResult = await scrapeLandingPage(landingPageUrl.trim());

    let pageData;
    if (!scrapeResult.success) {
      if (scrapeResult.jsRendered) {
        
        console.log("  JS-rendered page — using fallback");
        pageData = { title: new URL(landingPageUrl).hostname, h1:"", h2:"", metaDescription:"", ctaButtons:[], bodyText:"" };
      } else {
        return sendError(res, 422, "SCRAPE_FAILED", scrapeResult.error, "Try a different URL or a simpler page.");
      }
    } else {
      pageData = scrapeResult.data;
    }
    console.log(`  H1: "${pageData.h1 || "(empty)"}"`);

    // Step 2= Image
    let imageBase64, mimeType;
    if (req.file) {
      
      imageBase64 = req.file.buffer.toString("base64");
      mimeType    = req.file.mimetype;
      console.log(`[2] Image upload: ${req.file.originalname} (${mimeType})`);
    } else {
      console.log(`[2] Fetching image: ${adImageUrl}`);
      try {
        const imgRes = await axios.get(adImageUrl.trim(), {
          responseType: "arraybuffer",
          timeout: 15000,
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        mimeType = imgRes.headers["content-type"]?.split(";")[0] || "image/jpeg";
        
        if (!mimeType.startsWith("image/"))
          return sendError(res, 400, "NOT_AN_IMAGE",
            "URL did not return an image file.",
            "Make sure the URL ends with .jpg, .png etc and opens an image directly in your browser.");
        imageBase64 = Buffer.from(imgRes.data).toString("base64");
      } catch (imgErr) {
        return sendError(res, 400, "IMAGE_FETCH_FAILED",
          `Could not fetch ad image: ${imgErr.message}`,
          "Check the URL is publicly accessible.");
      }
    }

    // Step 3= gemini vision
    console.log("[3] Analyzing ad...");
    let adData;
    try {
      adData = await analyzeAdCreative(imageBase64, mimeType);
    } catch (err) {
      return sendError(res, 502, "VISION_FAILED",
        `Ad analysis failed: ${err.message}`,
        err.response?.data?.error?.message || null);
    }
    console.log(`  Offer: "${adData.primaryOffer}"`);

    //Step4= gemini test
    console.log("[4] Generating copy...");
    let personalized;
    try {
      personalized = await generatePersonalizedCopy(adData, pageData);
    } catch (err) {
      return sendError(res, 502, "COPY_FAILED",
        `Copy generation failed: ${err.message}`,
        err.response?.data?.error?.message || null);
    }

    //Step 5= validate + diff
    const warnings = validateOutput(personalized, adData, pageData);
    const diff = {
      before: { headline: pageData.h1, subheadline: pageData.h2, ctaText: pageData.ctaButtons[0] || "", metaDescription: pageData.metaDescription },
      after:  { headline: personalized.headline, subheadline: personalized.subheadline, ctaText: personalized.ctaText, metaDescription: personalized.metaDescription },
    };

    console.log("[5] Done ✓\n");

    res.json({
      success:    true,
      adAnalysis: adData,
      personalized,
      diff,
      warnings,
      scrapeNote: scrapeResult.jsRendered ? "Page appeared JS-rendered — limited content was available." : null,
    });

  } catch (err) {
    console.error("Unhandled:", err.message);
    if (err.response?.status === 429)
      return sendError(res, 429, "RATE_LIMITED", "Gemini rate limit hit.", "Wait 60 seconds and try again.");
    if (err.response?.status === 400)
      return sendError(res, 400, "GEMINI_BAD_REQUEST", "Gemini rejected the request.", err.response?.data?.error?.message);
    sendError(res, 500, "INTERNAL_ERROR", "Unexpected server error.", err.message);
  }
});

app.listen(PORT, () => {
  console.log(`
  ╭──────────────────────────────────────────────╮
  │  AdMorph AI                                  │
  │  http://localhost:${PORT}                        │
  │  Gemini: ${GEMINI_KEY ? "✓ configured" : "✗ KEY MISSING — check .env"}          │
  │  Health: http://localhost:${PORT}/api/health     │
  ╰──────────────────────────────────────────────╯
  `);
});