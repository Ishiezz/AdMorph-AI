const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "../frontend/public")));

const upload = multer({ dest: "uploads/" });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;


app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    gemini: GEMINI_API_KEY ? "configured" : "missing",
  });
});

async function scrapeLandingPage(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const $ = cheerio.load(data);
    $("script, style, nav, footer, noscript, head").remove();

    const scraped = {
      title:           $("title").text().trim() || "Untitled",
      h1:              $("h1").first().text().trim() || "",
      h2:              $("h2").first().text().trim() || "",
      metaDescription: $('meta[name="description"]').attr("content") || "",
      ctaButtons:      [],
      bodyText:        $("body").text().replace(/\s+/g, " ").trim().slice(0, 1200),
    };

    $("button, a.btn, a.button, [class*='cta'], [class*='btn']").each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 60 && i < 5) scraped.ctaButtons.push(text);
    });

    return { success: true, data: scraped };
  } catch (err) {
    return {
      success: false,
      error: `Could not scrape page: ${err.message}`,
    };
  }
}

async function analyzeAdCreative(imageBase64, mimeType) {
  const prompt = `You are an expert digital marketer. Analyze this ad creative image carefully.

Return ONLY a valid JSON object with no markdown, no code fences, no explanation:
{
  "primaryOffer": "the main offer or value proposition shown in the ad",
  "targetAudience": "who this ad is targeting",
  "tone": "emotional tone (e.g. fun, professional, urgent, inspirational)",
  "ctaText": "the call-to-action button or phrase visible in the ad",
  "keyBenefits": ["benefit1", "benefit2"],
  "visualTheme": "brief description of visual style",
  "urgency": "high or medium or low",
  "adHeadline": "the main headline text visible in the ad"
}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 800,
    },
  };

  const response = await axios.post(GEMINI_VISION_URL, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  let raw = response.data.candidates[0].content.parts[0].text.trim();

  
  raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  return JSON.parse(raw);
}

async function generatePersonalizedCopy(adData, pageData) {
  const prompt = `You are a senior CRO (Conversion Rate Optimization) specialist.

Your task: Rewrite specific parts of a landing page so it matches the ad creative the user clicked.

AD CREATIVE DATA:
${JSON.stringify(adData, null, 2)}

EXISTING LANDING PAGE:
- Title: ${pageData.title}
- H1 (headline): ${pageData.h1}
- H2 (subheadline): ${pageData.h2}
- Meta description: ${pageData.metaDescription}
- CTA buttons found: ${pageData.ctaButtons.join(", ") || "none detected"}
- Body excerpt: ${pageData.bodyText.slice(0, 500)}

STRICT RULES YOU MUST FOLLOW:
1. Only modify these 5 fields: headline, subheadline, ctaText, metaDescription, heroBody
2. Do NOT invent prices, statistics, or claims not present in the ad or the original page
3. Keep the brand voice consistent with the original page
4. Match the exact tone and audience from the ad data
5. Apply message match: the visitor clicked an ad — the page must feel like a continuation of it

Return ONLY a valid JSON object, no markdown, no code fences, no explanation:
{
  "headline": "new H1 — short, punchy, matches ad offer",
  "subheadline": "new H2 — supports the headline, audience-aware",
  "ctaText": "new CTA button text — action-oriented, matches ad CTA",
  "metaDescription": "new meta description — 150 chars max",
  "heroBody": "1-2 sentence hero body copy — reinforces offer for target audience",
  "changeRationale": "2-3 sentence explanation of why these changes improve conversion",
  "changesApplied": ["change 1 description", "change 2 description", "change 3 description"]
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1000,
    },
  };

  const GEMINI_TEXT_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
  const response = await axios.post(GEMINI_TEXT_URL, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  let raw = response.data.candidates[0].content.parts[0].text.trim();
  raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  return JSON.parse(raw);
}


function validateOutput(personalized, adData, pageData) {
  const warnings = [];
  const numberRegex = /\d+%|\$\d+|£\d+|€\d+|\d+\s?(days|hours|users|customers|reviews)/gi;

  const outputText = [
    personalized.headline,
    personalized.subheadline,
    personalized.heroBody,
  ].join(" ");

  const sourceText = JSON.stringify(adData) + " " + pageData.bodyText + " " + pageData.h1;

  const foundNumbers = outputText.match(numberRegex) || [];
  foundNumbers.forEach((num) => {
    const digits = num.replace(/\D/g, "");
    if (!sourceText.includes(digits)) {
      warnings.push(`Verify this figure — may be invented: "${num}"`);
    }
  });

  return warnings;
}

app.post("/api/personalize", upload.single("adImage"), async (req, res) => {
  try {
    const { landingPageUrl, adImageUrl } = req.body;

    if (!landingPageUrl) {
      return res.status(400).json({ error: "Landing page URL is required." });
    }

    if (!req.file && !adImageUrl) {
      return res.status(400).json({ error: "Ad image or image URL is required." });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not set. Add it to your .env file.",
      });
    }

   
    console.log("→ Scraping:", landingPageUrl);
    const scrapeResult = await scrapeLandingPage(landingPageUrl);

    if (!scrapeResult.success) {
      return res.status(422).json({
        error: scrapeResult.error,
        tip: "Try a simpler public URL or paste the copy manually.",
      });
    }

    const pageData = scrapeResult.data;
    console.log("  Scraped H1:", pageData.h1 || "(none found)");

    let imageBase64, mimeType;

    if (req.file) {
      imageBase64 = fs.readFileSync(req.file.path).toString("base64");
      mimeType = req.file.mimetype;
      fs.unlinkSync(req.file.path);
    } else {
      const imgRes = await axios.get(adImageUrl, { responseType: "arraybuffer", timeout: 15000 });
      imageBase64 = Buffer.from(imgRes.data).toString("base64");
      mimeType = imgRes.headers["content-type"] || "image/jpeg";
    }

    
    console.log("→ Analyzing ad with Gemini Vision...");
    const adData = await analyzeAdCreative(imageBase64, mimeType);
    console.log("  Offer detected:", adData.primaryOffer);

  
    console.log("→ Generating personalized copy...");
    const personalized = await generatePersonalizedCopy(adData, pageData);

   
    const warnings = validateOutput(personalized, adData, pageData);

    const diff = {
      before: {
        headline:        pageData.h1,
        subheadline:     pageData.h2,
        ctaText:         pageData.ctaButtons[0] || "",
        metaDescription: pageData.metaDescription,
      },
      after: {
        headline:        personalized.headline,
        subheadline:     personalized.subheadline,
        ctaText:         personalized.ctaText,
        metaDescription: personalized.metaDescription,
      },
    };

    console.log("✓ Done\n");

    res.json({
      success:     true,
      adAnalysis:  adData,
      personalized,
      diff,
      warnings,
      pageUrl:     landingPageUrl,
    });

  } catch (err) {
    console.error("✗ Error:", err.message);

    
    if (err.response?.data?.error) {
      const geminiErr = err.response.data.error;
      return res.status(500).json({
        error: `Gemini API error: ${geminiErr.message}`,
        code:  geminiErr.code,
      });
    }

    res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`
  ╭──────────────────────────────────────────╮
  │   AdMorph AI                             │
  │   http://localhost:${PORT}                   │
  │   Gemini Vision: ${GEMINI_API_KEY ? "✓ Ready" : "✗ Key missing"}           │
  ╰──────────────────────────────────────────╯
  `);
});